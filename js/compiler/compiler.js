/* PLC-CORE-MDE — Compiler v5 — FBD + Ladder → IR
   ─────────────────────────────────────────────────────────────
   Bloque 1 (v3): compileFBD() assigns address:{area,index},
                  generates symbolTable, enriches meta.
   Bloque 3 (v4): compileLadder() fully rewritten:
     • Processes rungs in the new paths/outputs format
       (ladder_ast.js model: paths=[[elem,...]], outputs=[coil,...])
     • varToNodeIdx: global map — same variable → same IR node
       across all rungs (critical for M/T/C cross-rung references)
     • SET/RESET coils accumulate conditions via OR chains —
       multiple SET rungs and RESET rungs on the same M variable
       all feed into a single SR node correctly
     • AND chains for N contacts (left-associative binary tree)
     • OR chains for N parallel paths (same structure)
     • address:{area,index} assigned from variable name (X0→0,
       T2→2) — deterministic, no counters needed for Ladder
     • order[] topological sort (same Kahn algorithm as FBD)
     • symbolTable via PlcSymbolTable.build() (unchanged)
     • irToDrawflow() synthesises the drawflow.Home.data object
       that parseProgram() on ESP32 reads — Ladder programs are
       fully transparent to the runtime
   ─────────────────────────────────────────────────────────────
   Fase 1-6 (v5): compileLadderAST() — new entry point for the
                  LadderProgram AST model (ladder_program.js):
     • Accepts programs in { version:'ladder_v1', rungs:[] } format
     • Delegates to LadderCompiler.compileLadderToIR() in
       ladder_program.js (LadderNormalizer + LadderCompiler)
     • irToDrawflow() called here to add the drawflow field for
       the ESP32 runtime — transparent to the runtime
   ─────────────────────────────────────────────────────────────
   RUNTIME CONTRACT:
     compileFBD(), compileLadder(), and compileLadderAST() all
     produce identical IR format. The runtime (plc_runtime.cpp)
     reads doc["drawflow"]["Home"]["data"] and is unaware of source.
   ─────────────────────────────────────────────────────────────
*/
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PlcCompiler = factory();
}(typeof self !== 'undefined' ? self : this, function() {

  // Declared memory sizes — must match plc_memory.h MEM_*_SIZE
  var MEM = {X:64, Y:64, M:64, T:32, C:32, A:16, R:32};

  // =========================================================
  // SHARED HELPERS
  // =========================================================

  /* Build a base IR node with all required fields */
  function _mkNode(id, type) {
    return {
      id:id, type:type,
      in1:null, in2:null, outputs:[],
      preset:0, value:0, op:'>', outIdx:0,
      pv:0, inMin:0, inMax:4095, outMin:0, outMax:100,
      memIn1:null, memIn2:null, memOut:null
      // address field added separately where applicable
    };
  }

  /* Topological sort — Kahn's algorithm.
     nodes[i].outputs contains Drawflow IDs (for FBD) or
     direct targets (for Ladder after _buildOutputRefs).
     idToIdx maps node.id → array index.                   */
  function _topo(nodes, idToIdx) {
    var n     = nodes.length;
    var indeg = new Array(n).fill(0);
    var adj   = nodes.map(function(){ return []; });
    nodes.forEach(function(nd, j) {
      nd.outputs.forEach(function(tid) {
        var ti = idToIdx[tid];
        if (ti !== undefined) { adj[j].push(ti); indeg[ti]++; }
      });
    });
    var q = [], res = [];
    indeg.forEach(function(d, i){ if (d === 0) q.push(i); });
    while (q.length) {
      var cur = q.shift(); res.push(cur);
      adj[cur].forEach(function(nx){ if (--indeg[nx] === 0) q.push(nx); });
    }
    // Append any remaining (cycles — should not occur in valid programs)
    for (var i = 0; i < n; i++) if (res.indexOf(i) === -1) res.push(i);
    return res;
  }

  /* Build final IR envelope */
  function _ir(nodes, order, src, symbolTable) {
    var meta = {
      source:    src,
      compiled:  new Date().toISOString(),
      nodeCount: nodes.length,
      version:   4
    };
    if (symbolTable) meta.symbolTable = symbolTable;
    return {
      format:  'ir',
      meta:    meta,
      memory:  MEM,
      program: { nodes: nodes },
      order:   order
    };
  }

  /* Read int field from raw Drawflow node data */
  function _ri(raw, k, def) {
    var d = raw.data;
    if (!d || d[k] === undefined || d[k] === null) return def;
    if (typeof d[k] === 'number') return d[k];
    var n = parseInt(String(d[k]), 10);
    return isNaN(n) ? def : n;
  }
  function _rs(raw, k, def) {
    var d = raw.data;
    if (!d || d[k] === undefined || d[k] === null) return def;
    return String(d[k]);
  }

  // =========================================================
  // FBD ADDRESS ASSIGNMENT (Bloque 1 — unchanged)
  // =========================================================

  /* Fixed-index nodes: address comes from node type name */
  var _FIXED_INDEX = {
    input1:  {area:'X', index:0},
    input2:  {area:'X', index:1},
    output1: {area:'Y', index:0},
    output2: {area:'Y', index:1},
    output3: {area:'Y', index:2},
    output4: {area:'Y', index:3},
    analog1: {area:'A', index:0}
  };

  /* Counter-area nodes: assigned sequentially by appearance */
  var _COUNTER_AREA = {
    ton:'T', tof:'T', tp:'T', blink:'T',
    ctu:'C', ctd:'C',
    sr:'M',  rs:'M', r_trig:'M', f_trig:'M'
  };

  /* Assign address fields to FBD nodes in stable id-ascending order */
  function _assignAddresses(nodes) {
    var sorted   = nodes.slice().sort(function(a, b){ return a.id - b.id; });
    var counters = {T:0, C:0, M:0};
    sorted.forEach(function(nd) {
      var fixed = _FIXED_INDEX[nd.type];
      if (fixed) { nd.address = {area:fixed.area, index:fixed.index}; return; }
      var area = _COUNTER_AREA[nd.type];
      if (area) { nd.address = {area:area, index:counters[area]++}; }
      // Combinational nodes (and/or/not/xor/cmp/scale/pwm) — no address
    });
  }

  // =========================================================
  // LADDER ADDRESS HELPERS
  // =========================================================

  /* Parse a variable name like "X0", "M3", "T2", "Y1" into
     {area, index}. Returns null for invalid names.           */
  function _parseVarAddr(varName) {
    if (!varName) return null;
    var m = /^([XYMTCxymtc])(\d+)$/.exec(varName);
    if (!m) return null;
    return {area: m[1].toUpperCase(), index: parseInt(m[2], 10)};
  }

  /* Map variable area to the IR node type used for reading.
     Contacts on X/Y/M/T/C all produce a node of the appropriate
     type. The node is shared via varToNodeIdx.                */
  function _varReadType(area) {
    // X → input1/input2 (resolved later from index)
    // Y → output1-4 (resolved from index)
    // M → sr  (memory bit — state persists between scans)
    // T → ton (timer done bit — read from timer node state)
    // C → ctu (counter Q — read from counter node state)
    var map = {X:'input1', Y:'output1', M:'sr', T:'ton', C:'ctu'};
    return map[area] || 'input1';
  }

  /* For X inputs, the exact type depends on the physical index */
  function _xNodeType(index) {
    // input1 = X0, input2 = X1 (matches getInputPhysIndex in runtime)
    return (index === 0) ? 'input1' : 'input2';
  }

  /* For Y outputs, the exact type depends on the physical index */
  function _yNodeType(index) {
    return ['output1','output2','output3','output4'][index] || 'output1';
  }

  // =========================================================
  // DRAWFLOW SYNTHESIS
  // =========================================================

  /* irToDrawflow(irNodes)
     ─────────────────────
     Synthesises the drawflow.Home.data object from IR nodes.
     This is what parseProgram() on the ESP32 reads.

     For each node we need:
       • id, name (= type), data{}, outputs{ port: {connections:[]} }

     The outputs object is built by inverting the in1/in2 graph:
     for each node that has a driver (in1/in2), we register
     a connection FROM the driver TO this node.

     parseProgram() specifically reads:
       node["id"], node["name"], node["data"][key], node["outputs"]
     All other fields are ignored by the C++ parser.             */
  function irToDrawflow(irNodes) {
    // Pass 1: build a map  nodeArrayIdx → { id, name, data, outputs{} }
    var byIdx = {};
    irNodes.forEach(function(nd, i) {
      // Build the data{} sub-object for this node type
      var data = {};
      if (nd.preset  > 0)  data.time    = nd.preset;
      if (nd.value   !== 0) data.value  = nd.value;
      if (nd.op !== '>')    data.op     = nd.op;
      if (nd.outIdx  > 0)  data.out     = nd.outIdx;
      if (nd.scaleInMin  !== undefined && nd.scaleInMin  !== 0) data.inMin  = nd.scaleInMin;
      if (nd.scaleInMax  !== undefined && nd.scaleInMax  !== 4095) data.inMax = nd.scaleInMax;
      if (nd.scaleOutMin !== undefined && nd.scaleOutMin !== 0) data.outMin = nd.scaleOutMin;
      if (nd.scaleOutMax !== undefined && nd.scaleOutMax !== 100) data.outMax = nd.scaleOutMax;
      // Timer preset — runtime reads 'time' key
      if ((nd.type === 'ton' || nd.type === 'tof' || nd.type === 'tp' || nd.type === 'blink')
          && nd.preset > 0) {
        data.time = nd.preset;
      }
      // Counter preset — runtime reads 'value' key for CTU/CTD
      if ((nd.type === 'ctu' || nd.type === 'ctd') && nd.value > 0) {
        data.value = nd.value;
      }

      // Build inputs{} — Drawflow.addNodeImport() iterates Object.keys(inputs)
      // and crashes if the field is missing.  IR nodes have in1/in2 as array
      // indices (not drawflow port objects), so we reconstruct port objects here.
      var inputs = {};
      // We'll fill connections in pass 2 (inverted graph).  For now create
      // placeholder port entries — the count is determined by node type.
      var inputCount = _drawflowInputCount(nd.type);
      for (var p = 0; p < inputCount; p++) {
        inputs['input_' + (p + 1)] = { connections: [] };
      }

      // Build node HTML — must match the templates in editor.js exactly so that
      // Drawflow can restore df-* data bindings when the FBD editor imports this.
      var nodeHtml = _irNodeHtml(nd);

      byIdx[i] = {
        id:       nd.id,
        name:     nd.type,   // runtime uses 'name' field for dispatch
        data:     data,
        class:    nd.type,   // Drawflow uses this for CSS class; must be a string
        html:     nodeHtml,
        typenode: false,     // plain HTML node, not a registered component
        inputs:   inputs,    // required by addNodeImport — Object.keys() is called
        outputs:  {},        // filled in Pass 2
        pos_x:    (i % 8) * 140 + 60,   // auto-layout: 8 columns
        pos_y:    Math.floor(i / 8) * 100 + 60
      };
    });

    // Pass 2: build connections bidirectionally.
    // Drawflow stores connections in BOTH directions:
    //   driver.outputs['output_1'].connections → [{node: targetId, output: 'input_1'}]
    //   target.inputs['input_1'].connections   → [{node: driverId, input: 'output_1'}]
    // addNodeImport() reads inputs{} to draw SVG edges. If inputs{} is empty,
    // no connection lines appear in the canvas even though outputs{} is correct.
    irNodes.forEach(function(nd, i) {
      var addConn = function(driverIdx, inputPort) {
        if (driverIdx === null || driverIdx === undefined || driverIdx < 0) return;
        var driver = byIdx[driverIdx];
        var target = byIdx[i];
        if (!driver || !target) return;

        // ── Outputs side (driver → target) ──────────────────
        if (!driver.outputs['output_1']) {
          driver.outputs['output_1'] = {connections: []};
        }
        driver.outputs['output_1'].connections.push({
          node:   String(nd.id),
          output: inputPort          // Drawflow calls target's port 'output' here
        });

        // ── Inputs side (target ← driver) ───────────────────
        // Ensure the input port exists (it should — we created it in Pass 1,
        // but guard anyway for robustness).
        if (!target.inputs[inputPort]) {
          target.inputs[inputPort] = {connections: []};
        }
        target.inputs[inputPort].connections.push({
          node:  String(byIdx[driverIdx].id),
          input: 'output_1'          // Drawflow calls driver's port 'input' here
        });
      };
      if (nd.in1 !== null && nd.in1 !== undefined) addConn(nd.in1, 'input_1');
      if (nd.in2 !== null && nd.in2 !== undefined) addConn(nd.in2, 'input_2');
    });

    // Pass 3: assemble into the drawflow.Home.data map
    var data = {};
    Object.keys(byIdx).forEach(function(i) {
      var entry = byIdx[i];
      data[String(entry.id)] = entry;
    });

    return { drawflow: { Home: { data: data } } };
  }

  /* _drawflowInputCount(type) → number
     Returns the number of input ports a node of this type has in Drawflow.
     Needed by irToDrawflow to build the inputs{} object that Drawflow.import
     expects.  Must match the addNode() calls in editor.js exactly.          */
  function _drawflowInputCount(type) {
    // 0 inputs
    if (['input1','input2','analog1'].indexOf(type) >= 0) return 0;
    // 2 inputs
    if (['and','or','xor','cmp','sr','rs','ctu','ctd'].indexOf(type) >= 0) return 2;
    // 1 input (everything else: output1-4, not, ton, tof, tp, blink, r_trig, f_trig, scale, pwm)
    return 1;
  }

  /* _irNodeHtml(nd) → HTML string
     Generates the innerHTML for a Drawflow node that matches the template used
     by editor.js addNode() calls. This ensures df-time / df-value bindings work
     when the FBD editor imports a drawflow object reconstructed from IR.       */
  function _irNodeHtml(nd) {
    var t = nd.type;
    var preset = nd.preset || 0;
    var value  = nd.value  || 0;

    // ── Timers ────────────────────────────────────────────────
    if (t === 'ton') {
      return '<div>' + 'TON<br>' +
        '<input type="number" df-time value="' + preset + '" style="width:60px"> ms' +
        '</div>';
    }
    if (t === 'tof') {
      return '<div>' + 'TOF<br>' +
        '<input type="number" df-time value="' + preset + '" style="width:60px"> ms' +
        '</div>';
    }
    if (t === 'tp') {
      return '<div>' + 'TP<br>' +
        '<input type="number" df-time value="' + preset + '" style="width:60px"> ms' +
        '</div>';
    }
    if (t === 'blink') {
      return '<div><div class="title-box">BLINK</div>' +
        'T:<input type="number" df-time value="' + preset + '" style="width:55px"> ms' +
        '</div>';
    }

    // ── Counters ──────────────────────────────────────────────
    if (t === 'ctu') {
      return '<div><div class="title-box">CTU</div>' +
        'PV:<input type="number" df-value value="' + value + '" style="width:50px">' +
        '</div>';
    }
    if (t === 'ctd') {
      return '<div><div class="title-box">CTD</div>' +
        'PV:<input type="number" df-value value="' + value + '" style="width:50px">' +
        '</div>';
    }

    // ── Logic gates ───────────────────────────────────────────
    if (t === 'and')   return '<div>AND</div>';
    if (t === 'or')    return '<div>OR</div>';
    if (t === 'not')   return '<div>NOT</div>';
    if (t === 'xor')   return '<div class="title-box">XOR</div>';
    if (t === 'sr')    return '<div class="title-box">SR</div><div style="font-size:9px;color:#aaa">S dom.</div>';
    if (t === 'rs')    return '<div class="title-box">RS</div><div style="font-size:9px;color:#aaa">R dom.</div>';
    if (t === 'r_trig') return '<div class="title-box">R_TRIG</div><div style="font-size:9px;color:#aaa">Flanco ↑</div>';
    if (t === 'f_trig') return '<div class="title-box">F_TRIG</div><div style="font-size:9px;color:#aaa">Flanco ↓</div>';

    // ── Comparator ────────────────────────────────────────────
    if (t === 'cmp') {
      var op  = nd.op    || '>';
      var val = nd.value || 0;
      return '<div style="font-size:12px">CMP<br>' +
        '<select df-op style="width:50px">' +
          '<option value=">"' + (op==='>'?' selected':'') + '>&gt;</option>' +
          '<option value="<"' + (op==='<'?' selected':'') + '>&lt;</option>' +
          '<option value="=="' + (op==='=='?' selected':'') + '>==</option>' +
          '<option value=">="' + (op==='>='?' selected':'') + '>&gt;=</option>' +
          '<option value="<="' + (op==='<='?' selected':'') + '>&lt;=</option>' +
        '</select>' +
        '<input type="number" df-value value="' + val + '" style="width:60px">' +
        '</div>';
    }

    // ── Scale ─────────────────────────────────────────────────
    if (t === 'scale') {
      return '<div style="font-size:10px"><div class="title-box">SCALE</div>' +
        'in: <input type="number" df-inMin value="' + (nd.scaleInMin  || 0)    + '" style="width:40px">-' +
             '<input type="number" df-inMax value="' + (nd.scaleInMax  || 4095) + '" style="width:45px"><br>' +
        'out:<input type="number" df-outMin value="' + (nd.scaleOutMin || 0)   + '" style="width:40px">-' +
             '<input type="number" df-outMax value="' + (nd.scaleOutMax|| 100)  + '" style="width:45px">' +
        '</div>';
    }

    // ── PWM ───────────────────────────────────────────────────
    if (t === 'pwm') {
      return '<div>PWM<br>OUT:' +
        '<select df-out>' +
          '<option value="0">1</option><option value="1">2</option>' +
          '<option value="2">3</option><option value="3">4</option>' +
        '</select>' +
        '<input type="number" df-value value="' + (nd.value||1000) + '" style="width:60px">' +
        '</div>';
    }

    // ── IO nodes ──────────────────────────────────────────────
    if (t === 'input1')  return '<div>IN1</div>';
    if (t === 'input2')  return '<div>IN2</div>';
    if (t === 'output1') return '<div>OUT1</div>';
    if (t === 'output2') return '<div>OUT2</div>';
    if (t === 'output3') return '<div>OUT3</div>';
    if (t === 'output4') return '<div>OUT4</div>';
    if (t === 'analog1') return '<div>AI1</div>';

    // Fallback for unknown types
    return '<div>' + t + '</div>';
  }

  // =========================================================
  // FBD COMPILER (Bloque 1 — unchanged interface)
  // =========================================================

  function compileFBD(src) {
    var doc  = typeof src === 'string' ? JSON.parse(src) : src;
    var data = doc.drawflow && doc.drawflow.Home && doc.drawflow.Home.data;
    if (!data) throw new Error('JSON Drawflow inválido');

    var nodes = [], idToIdx = {};

    // Pass 1 — build nodes
    Object.keys(data).forEach(function(k) {
      var raw = data[k], idx = nodes.length;
      idToIdx[raw.id] = idx;
      var nd = _mkNode(raw.id, raw.name);
      nd.preset  = _ri(raw,'time',0);
      nd.value   = _ri(raw,'value',0);
      nd.op      = _rs(raw,'op','>');
      nd.outIdx  = _ri(raw,'out',0);
      nd.pv      = _ri(raw,'pv',0);
      nd.inMin   = _ri(raw,'inMin',0);
      nd.inMax   = _ri(raw,'inMax',4095);
      nd.outMin  = _ri(raw,'outMin',0);
      nd.outMax  = _ri(raw,'outMax',100);
      nd.scaleInMin  = nd.inMin;
      nd.scaleInMax  = nd.inMax;
      nd.scaleOutMin = nd.outMin;
      nd.scaleOutMax = nd.outMax;
      if (raw.outputs) {
        Object.keys(raw.outputs).forEach(function(p) {
          (raw.outputs[p].connections || []).forEach(function(c) {
            var tid = parseInt(String(c.node), 10);
            if (!isNaN(tid)) nd.outputs.push(tid);
          });
        });
      }
      nodes.push(nd);
    });

    // Pass 2 — resolve in1/in2
    nodes.forEach(function(nd) {
      var drivers = [];
      nodes.forEach(function(src, j) {
        if (src.outputs.indexOf(nd.id) !== -1) drivers.push(j);
      });
      if (drivers.length >= 1) nd.in1 = drivers[0];
      if (drivers.length >= 2) nd.in2 = drivers[1];
    });

    // Pass 3 — assign address:{area,index}
    _assignAddresses(nodes);

    // Pass 4 — build symbol table
    var symbolTable = null;
    if (typeof PlcSymbolTable !== 'undefined') {
      var buildResult = PlcSymbolTable.build(nodes);
      var ck = (typeof src === 'object')
               ? PlcSymbolTable.canonicalKey(src)
               : PlcSymbolTable.canonicalKey(doc);
      symbolTable = PlcSymbolTable.formatForEnvelope(buildResult, ck, 'fbd');
    }

    return _ir(nodes, _topo(nodes, idToIdx), 'fbd', symbolTable);
  }

  // =========================================================
  // LADDER COMPILER v2 (Bloque 3)
  // =========================================================

  /* compileLadder(src)
     ──────────────────
     src: { rungs: [ rung, ... ] }

     rung (paths format from ladder_ast.js / ladder.html):
       {
         id:      string,
         comment: string,
         paths:   [ [elem, ...], ... ],   // parallel paths (OR'd)
         outputs: [ coil, ... ]
       }
     elem: { type:'CONTACT', var:'X0', negated:bool }
           { type:'BLOCK',   blockType:'TON', id:'T0', preset:1000 }
     coil: { type:'COIL', var:'Y0', mode:'NORMAL'|'SET'|'RESET' }

     PIPELINE:
       Pass 1 — First scan of all rungs: build varState map.
                Create IR nodes for every unique variable reference.
       Pass 2 — Second scan: for each rung build the condition
                expression (AND/OR chains) and wire it to coil nodes.
       Pass 3 — Build OR accumulators for variables with multiple
                SET or RESET contributions.
       Pass 4 — Resolve outputs[] (needed by _topo).
       Pass 5 — Topological sort.
       Pass 6 — Build symbol table.                              */
  function compileLadder(src) {
    var doc   = typeof src === 'string' ? JSON.parse(src) : src;
    var rungs = (doc && doc.rungs) ? doc.rungs : [];

    if (rungs.length === 0) {
      throw new Error('No rungs in Ladder program');
    }

    var nodes   = [];   // flat IR node array
    var nextId  = 1;    // unique node ID counter

    /* ── varState: central map variable name → node descriptors ──
       For each unique variable referenced in the program we track:
         readIdx  — array index of the node to read state FROM
                    (contacts connect their driver chain to this)
         setList  — array of condition node indices that SET this var
                    (only for M coils with mode SET)
         resetList— array of condition node indices that RESET this var
         writeIdx — array index of the SR/output node that is the
                    final writable node (= same as readIdx for M)
         created  — bool, true once the node has been emitted      */
    var varState = {};

    /* ── Helpers ──────────────────────────────────────────────── */

    function emit(nd) {
      nodes.push(nd);
      return nodes.length - 1;
    }

    function mkNode(type) {
      var nd = _mkNode(nextId++, type);
      return nd;
    }

    /* Parse "X0" → {area:'X', index:0} */
    function parseAddr(v) {
      var a = _parseVarAddr(v);
      if (!a) throw new Error('Invalid variable name: ' + v);
      return a;
    }

    /* Get or create the IR node representing a variable for reading.
       For X/Y: fixed-type node (input1/input2, output1-4).
       For M:   sr node — persists state between scans.
       For T:   ton node — timer; contact reads its done bit.
       For C:   ctu node — counter; contact reads its Q bit.
       Returns the array index of the read node.                   */
    function getOrCreateReadNode(varName) {
      if (varState[varName] && varState[varName].created) {
        return varState[varName].readIdx;
      }

      var addr = parseAddr(varName);
      var nd, idx;

      if (addr.area === 'X') {
        nd = mkNode(_xNodeType(addr.index));
        nd.outIdx  = addr.index;
        nd.memIn1  = addr.index; // physical input index for parseProgram
        nd.address = {area:'X', index:addr.index};
        idx = emit(nd);

      } else if (addr.area === 'Y') {
        nd = mkNode(_yNodeType(addr.index));
        nd.outIdx  = addr.index;
        nd.address = {area:'Y', index:addr.index};
        idx = emit(nd);

      } else if (addr.area === 'M') {
        // SR node — Set-dominant latch for internal memory bit
        // in1 will be SET accumulator, in2 will be RESET accumulator
        // Both wired in Pass 3. For now create with in1/in2 = null.
        nd = mkNode('sr');
        nd.address = {area:'M', index:addr.index};
        idx = emit(nd);

      } else if (addr.area === 'T') {
        // TON node — preset wired when a BLOCK element provides it,
        // otherwise create a placeholder (preset=0 means immediate done)
        nd = mkNode('ton');
        nd.address = {area:'T', index:addr.index};
        idx = emit(nd);

      } else if (addr.area === 'C') {
        // CTU node — same pattern as TON
        nd = mkNode('ctu');
        nd.address = {area:'C', index:addr.index};
        idx = emit(nd);

      } else {
        throw new Error('Unsupported area: ' + addr.area + ' in ' + varName);
      }

      varState[varName] = {
        created:   true,
        readIdx:   idx,
        writeIdx:  idx,
        setList:   [],
        resetList: []
      };
      return idx;
    }

    /* Build a left-associative AND chain from an array of node indices.
       [a, b, c, d] → and(and(and(a,b),c),d)
       Returns the index of the final AND node (or the single node if N=1). */
    function buildANDChain(indices) {
      if (indices.length === 0) return null;
      var prev = indices[0];
      for (var i = 1; i < indices.length; i++) {
        var nd = mkNode('and');
        nd.in1 = prev;
        nd.in2 = indices[i];
        prev = emit(nd);
      }
      return prev;
    }

    /* Build a left-associative OR chain from an array of node indices.
       [a, b, c] → or(or(a,b),c)
       Returns the index of the final OR node (or the single node if N=1). */
    function buildORChain(indices) {
      if (indices.length === 0) return null;
      if (indices.length === 1) return indices[0];
      var prev = indices[0];
      for (var i = 1; i < indices.length; i++) {
        var nd = mkNode('or');
        nd.in1 = prev;
        nd.in2 = indices[i];
        prev = emit(nd);
      }
      return prev;
    }

    /* Compile a single element (contact or block) into an IR node index.
       Returns the index of the output signal node.                       */
    function compileElement(elem) {
      var varName = elem.var || elem.id || '';

      if (elem.type === 'CONTACT') {
        var readIdx = getOrCreateReadNode(varName);

        if (elem.negated) {
          // NC contact: NOT wrapper
          var notNd = mkNode('not');
          notNd.in1 = readIdx;
          return emit(notNd);
        }
        return readIdx;
      }

      if (elem.type === 'BLOCK') {
        // IEC function block in a path (TON, TOF, TP, CTU, CTD).
        // elem.blockType selects the exact runtime node type.
        // elem.id   ('T0', 'C1') → variable address.
        // elem.preset → timer ms or counter PV.
        var blockVar  = elem.id || varName;
        var blockAddr = parseAddr(blockVar);
        var blockIdx;

        // Resolve the runtime node type from elem.blockType.
        // Fallback: area T → 'ton', area C → 'ctu' (pre-blockType compat).
        var nodeTypeMap = {
          TON: 'ton', TOF: 'tof', TP: 'tp',
          CTU: 'ctu', CTD: 'ctd'
        };
        var blockNodeType = nodeTypeMap[elem.blockType] || null;

        if (blockAddr.area === 'T') {
          var timerType = blockNodeType || 'ton';   // default TON if blockType missing
          if (varState[blockVar] && varState[blockVar].created) {
            blockIdx = varState[blockVar].readIdx;
            // Update preset if provided; also fix node type if it differs
            if (elem.preset > 0) nodes[blockIdx].preset = elem.preset;
            if (blockNodeType) nodes[blockIdx].type = timerType;
          } else {
            var tnd = mkNode(timerType);
            tnd.preset  = elem.preset || 0;
            tnd.address = {area:'T', index:blockAddr.index};
            blockIdx = emit(tnd);
            varState[blockVar] = {
              created:true, readIdx:blockIdx, writeIdx:blockIdx,
              setList:[], resetList:[]
            };
          }
        } else if (blockAddr.area === 'C') {
          var counterType = blockNodeType || 'ctu';  // default CTU if blockType missing
          if (varState[blockVar] && varState[blockVar].created) {
            blockIdx = varState[blockVar].readIdx;
            if (elem.preset > 0) nodes[blockIdx].value = elem.preset;
            if (blockNodeType) nodes[blockIdx].type = counterType;
          } else {
            var cnd = mkNode(counterType);
            cnd.value   = elem.preset || 0;
            cnd.address = {area:'C', index:blockAddr.index};
            blockIdx = emit(cnd);
            varState[blockVar] = {
              created:true, readIdx:blockIdx, writeIdx:blockIdx,
              setList:[], resetList:[]
            };
          }
        } else {
          throw new Error('BLOCK area not supported: ' + blockVar);
        }
        // The block's Q output (state) is what the path reads
        return blockIdx;
      }

      throw new Error('Unknown element type: ' + elem.type);
    }

    /* Compile one path (series of elements) into a single condition index.
       Returns the index of the path's output signal.                       */
    function compilePath(path) {
      if (!path || path.length === 0) return null;

      // Standard compileLadder path: contacts and blocks in series.
      // IEC Ladder semantics for a block in a path:
      //   [A, B, BLOCK, C, D] → (A AND B) enables BLOCK.IN;
      //                         BLOCK.Q AND C AND D is the path output.
      // This means we split the path at each BLOCK element:
      //   - Contacts BEFORE the block → AND chain → block.in1
      //   - Block.Q → continues into the next segment
      //   - Contacts AFTER the block → AND with block.Q
      //
      // Simple implementation: scan for BLOCK elements and wire in1,
      // then continue accumulation from the block's output.

      var segments = [];    // [ [elems before block], block_elem, [elems after], ... ]
      var current  = [];
      path.forEach(function(elem) {
        if (elem && elem.type === 'BLOCK') {
          segments.push({ pre: current, block: elem });
          current = [];
        } else {
          current.push(elem);
        }
      });
      // Remaining elements after last block (or the whole path if no blocks)
      var tail = current;

      if (segments.length === 0) {
        // No blocks — original behaviour: AND chain of all contacts
        var indices = path.map(function(elem){ return compileElement(elem); });
        return buildANDChain(indices);
      }

      // Path has at least one block.
      // Walk segments: for each block, wire its IN from preceding contacts,
      // then the accumulated condition continues from block.Q.
      var condIdx = null;   // accumulated condition index

      segments.forEach(function(seg) {
        // Compile contacts before this block
        var preIndices = seg.pre.map(function(elem){ return compileElement(elem); });

        // Combine previous accumulated condition + pre-block contacts → block.in1
        var allPre = condIdx !== null ? [condIdx].concat(preIndices) : preIndices;
        var enableIdx = buildANDChain(allPre);

        // Compile the block element (creates/retrieves the IR node)
        var blockIdx = compileElement(seg.block);

        // Wire the block's IN signal = the enable condition
        if (enableIdx !== null && blockIdx !== null) {
          nodes[blockIdx].in1 = enableIdx;
        }

        // The accumulated condition after this block = block's Q output
        condIdx = blockIdx;
      });

      // Compile any contacts after the last block and AND with block.Q
      if (tail.length > 0) {
        var tailIndices = tail.map(function(elem){ return compileElement(elem); });
        var allTail = condIdx !== null ? [condIdx].concat(tailIndices) : tailIndices;
        condIdx = buildANDChain(allTail);
      }

      return condIdx;
    }

    /* Compile all parallel paths of a rung into a single OR result.
       Returns the index of the rung's combined condition.            */
    function compileRungCondition(rung) {
      var pathResults = [];
      (rung.paths || []).forEach(function(path) {
        if (!Array.isArray(path) || path.length === 0) return;
        var result = compilePath(path);
        if (result !== null) pathResults.push(result);
      });
      if (pathResults.length === 0) return null;
      return buildORChain(pathResults);
    }

    /* Wire a coil to the rung condition.
       NORMAL: create output node driven directly by conditionIdx.
       SET:    add conditionIdx to varState[var].setList.
       RESET:  add conditionIdx to varState[var].resetList.
       The SR node's in1/in2 are connected in Pass 3.              */
    function wireCoil(coil, conditionIdx) {
      if (conditionIdx === null) return;
      var varName = coil.var;
      var addr    = parseAddr(varName);
      var mode    = coil.mode || 'NORMAL';

      if (addr.area === 'Y') {
        // Digital output — direct connection
        var outNd = mkNode(_yNodeType(addr.index));
        outNd.outIdx  = addr.index;
        outNd.in1     = conditionIdx;
        outNd.address = {area:'Y', index:addr.index};
        emit(outNd);

      } else if (addr.area === 'M') {
        // Ensure the SR node exists
        getOrCreateReadNode(varName);
        var vs = varState[varName];

        if (mode === 'SET') {
          vs.setList.push(conditionIdx);
        } else if (mode === 'RESET') {
          vs.resetList.push(conditionIdx);
        } else {
          // NORMAL M coil: condition directly drives SR set input,
          // and implicit RESET when condition is false.
          // Model: SR.in1 = condition (set when true),
          //        SR.in2 = NOT(condition) effectively not needed
          // since SR is set-dominant. We treat NORMAL M as SET only
          // for simplicity — the SR holds state.
          vs.setList.push(conditionIdx);
        }

      } else if (addr.area === 'T') {
        // Timer block driven by condition: condition → ton.in1
        getOrCreateReadNode(varName);
        nodes[varState[varName].readIdx].in1 = conditionIdx;

      } else if (addr.area === 'C') {
        // Counter block driven by condition: condition → ctu.in1
        getOrCreateReadNode(varName);
        nodes[varState[varName].readIdx].in1 = conditionIdx;
      }
    }

    // ── Pass 1+2: compile all rungs ───────────────────────────
    rungs.forEach(function(rung) {
      var condIdx = compileRungCondition(rung);
      if (condIdx === null) return; // empty rung — skip

      (rung.outputs || []).forEach(function(coil) {
        wireCoil(coil, condIdx);
      });
    });

    // ── Pass 3: wire SET/RESET accumulators to SR nodes ────────
    Object.keys(varState).forEach(function(varName) {
      var vs   = varState[varName];
      var addr = _parseVarAddr(varName);
      if (!addr || addr.area !== 'M') return;

      var srNd = nodes[vs.readIdx];

      // Build OR of all SET conditions → in1 of SR
      if (vs.setList.length > 0) {
        srNd.in1 = buildORChain(vs.setList);
      }

      // Build OR of all RESET conditions → in2 of SR
      if (vs.resetList.length > 0) {
        srNd.in2 = buildORChain(vs.resetList);
      }
    });

    // ── Pass 4: build outputs[] (needed by _topo) ─────────────
    // Map node.id → array index
    var idToIdx = {};
    nodes.forEach(function(nd, i){ idToIdx[nd.id] = i; });

    // Build outputs[] from in1/in2 (inverted graph)
    nodes.forEach(function(nd, i) {
      var register = function(driverIdx) {
        if (driverIdx === null || driverIdx === undefined || driverIdx < 0) return;
        if (driverIdx >= nodes.length) return;
        nodes[driverIdx].outputs.push(nd.id);
      };
      register(nd.in1);
      register(nd.in2);
    });

    // ── Pass 5: topological sort ───────────────────────────────
    var order = _topo(nodes, idToIdx);

    // ── Pass 6: build symbol table ─────────────────────────────
    var symbolTable = null;
    if (typeof PlcSymbolTable !== 'undefined') {
      var buildResult = PlcSymbolTable.build(nodes);
      // Canonical key for Ladder uses rung IDs + var names
      var ck = _ladderCanonicalKey(rungs);
      symbolTable = PlcSymbolTable.formatForEnvelope(buildResult, ck, 'ladder');
    }

    // ── Pass 7: validation warnings ───────────────────────────
    var warnings = _validateLadderIR(nodes, rungs);
    if (typeof PlcSymbolTable !== 'undefined' && warnings.length > 0) {
      console.warn('[Ladder Compiler] Warnings:', warnings);
    }

    return _ir(nodes, order, 'ladder', symbolTable);
  }

  /* Canonical key for a Ladder program.
     Built from sorted rung IDs + element vars — stable fingerprint. */
  function _ladderCanonicalKey(rungs) {
    return rungs.map(function(r) {
      var pathStrs = (r.paths||[]).map(function(p) {
        return (p||[]).map(function(e){ return (e.var||e.id||'') + (e.negated?'!':''); }).join(',');
      }).join('|');
      var coilStrs = (r.outputs||[]).map(function(c){ return c.var+':'+c.mode; }).join(',');
      return (r.id||'') + '[' + pathStrs + '→' + coilStrs + ']';
    }).join(';');
  }

  /* Post-compile validation: check for variables used but never written */
  function _validateLadderIR(nodes, rungs) {
    var warnings = [];
    // Collect all variables that appear as contacts (read)
    var readVars = {};
    rungs.forEach(function(rung) {
      (rung.paths||[]).forEach(function(path) {
        (path||[]).forEach(function(elem) {
          if (elem && (elem.type==='CONTACT' || elem.type==='BLOCK')) {
            var v = elem.var || elem.id || '';
            if (v) readVars[v] = true;
          }
        });
      });
    });
    // Collect all variables that appear as coils (written)
    var writtenVars = {};
    rungs.forEach(function(rung) {
      (rung.outputs||[]).forEach(function(coil) {
        if (coil.var) writtenVars[coil.var] = true;
      });
    });
    // Warn if a non-X variable is read but never written
    Object.keys(readVars).forEach(function(v) {
      var a = _parseVarAddr(v);
      if (a && a.area !== 'X' && !writtenVars[v]) {
        warnings.push({
          code:    'VAR_READ_NOT_WRITTEN',
          message: 'Variable ' + v + ' used as contact but has no coil — always reads initial state (OFF)',
          varName: v
        });
      }
    });
    return warnings;
  }

  // =========================================================
  // compileProject — public entry point
  // =========================================================

  /* compileLadderAST(program)
     ────────────────────────────────────────────────────────
     Entry point for the new LadderProgram AST model.
     program: { version:'ladder_v1', rungs:[...] }

     Delegates to LadderCompiler.compileLadderToIR() in
     ladder_program.js, then adds the synthesised drawflow
     representation so the envelope builder in ladder.html
     can hoist it to the top level for the runtime.

     The module guard ensures graceful failure if
     ladder_program.js is not loaded (e.g. FBD-only pages).
  */
  function compileLadderAST(program) {
    if (typeof LadderProgram === 'undefined') {
      throw new Error(
        'compileLadderAST: ladder_program.js is not loaded. ' +
        'Add <script src="/js/compiler/ladder_program.js"></script> before compiler.js.'
      );
    }
    // LadderCompiler is exposed on the LadderProgram namespace
    var ir = LadderProgram.LadderCompiler.compileLadderToIR(program);

    // Synthesise drawflow for the runtime (same as compileLadder does)
    if (!ir.drawflow) {
      try {
        var dfEnv = irToDrawflow(ir.program.nodes);
        ir.drawflow = dfEnv.drawflow;
      } catch(e) {
        throw new Error('compileLadderAST: drawflow synthesis failed — ' + e.message);
      }
    }
    return ir;
  }

  function compileProject(source, type) {
    type = (type || 'fbd').toLowerCase();
    if (type === 'fbd')        return compileFBD(source);
    if (type === 'ladder')     return compileLadder(source);
    if (type === 'ladder_ast') return compileLadderAST(source);
    throw new Error('Unknown compiler type: ' + type);
  }

  // =========================================================
  // PUBLIC API
  // =========================================================
  return {
    compileProject:    compileProject,
    compileFBD:        compileFBD,
    compileLadder:     compileLadder,
    compileLadderAST:  compileLadderAST,
    irToDrawflow:      irToDrawflow,
    /* Expose internals for tools and tests */
    FIXED_INDEX:       _FIXED_INDEX,
    COUNTER_AREA:      _COUNTER_AREA
  };

}));
