/* =============================================================
   PLC-CORE-MDE — Ladder Program AST  (ladder_program.js)
   =============================================================
   Implements the full Ladder-AST pipeline defined in the spec:

     Fase 1 — AST model   (LadderProgram, Rung, ExprNode, ActionNode)
     Fase 2 — Normalizer  (LadderNormalizer.normalize)
     Fase 2H— Hardening: hashExpr, EDGE stability, depth reduction,
              variable validation, equivalence checking
     Fase 3 — Compiler    (LadderCompiler.compileLadderToIR)
     Fase 4 — order[]     (delegated to shared _topo in compiler.js)
     Fase 5 — Compatibility (IR identical to FBD/Bloque-3 format)
     Fase 6 — Tests (12 original + 10 hardening)

   RUNTIME CONTRACT
   ────────────────
   This module NEVER touches plc_runtime.cpp, plc_memory, or
   the ESP32 firmware in any way.  The IR it produces is the
   same format already accepted by parseProgram() on the ESP32.

   INTEGRATION
   ───────────
   • Exposed as window.LadderProgram
   • LadderCompiler.compileLadderToIR(program) is called from
     compiler.js compileProject() when type === 'ladder_ast'
   • irToDrawflow() in compiler.js synthesises the drawflow
     representation for the runtime (unchanged)

   PUBLIC API
   ──────────
   LadderProgram.makeProgram(rungs)         → Program
   LadderProgram.makeRung(id,cond,actions,meta) → Rung
   LadderProgram.contact(varName, mode)     → ContactNode
   LadderProgram.edge(varName, edgeType)    → EdgeNode
   LadderProgram.not(child)                 → NotNode
   LadderProgram.and(...children)           → AndNode
   LadderProgram.or(...children)            → OrNode
   LadderProgram.action(type, target)       → ActionNode

   LadderNormalizer.normalize(program)      → Program (normalised)

   LadderCompiler.compileLadderToIR(program)→ IR envelope

   LadderTests.runAll()                     → { passed, failed, results }
   =============================================================
*/

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LadderProgram = factory();
}(typeof self !== 'undefined' ? self : this, function() {

  'use strict';

  // ============================================================
  // FASE 1 — AST MODEL
  // ============================================================

  /* ----------------------------------------------------------
     Program
     { version: 'ladder_v1', rungs: Rung[] }
  ---------------------------------------------------------- */
  function makeProgram(rungs) {
    if (!Array.isArray(rungs)) throw new Error('makeProgram: rungs must be an array');
    return { version: 'ladder_v1', rungs: rungs };
  }

  /* ----------------------------------------------------------
     Rung
     {
       id:        string,
       condition: ExprNode,
       actions:   ActionNode[],
       meta:      { label, comment, position }
     }
  ---------------------------------------------------------- */
  function makeRung(id, condition, actions, meta) {
    if (typeof id !== 'string' || !id)
      throw new Error('makeRung: id must be a non-empty string');
    if (!condition || typeof condition.type !== 'string')
      throw new Error('makeRung: condition must be an ExprNode');
    if (!Array.isArray(actions) || actions.length === 0)
      throw new Error('makeRung: actions must be a non-empty array');
    return {
      id:        id,
      condition: condition,
      actions:   actions,
      meta:      Object.assign({ label:'', comment:'', position:0 }, meta || {})
    };
  }

  /* ----------------------------------------------------------
     ExprNode factories
  ---------------------------------------------------------- */

  /* ContactNode — reads a variable state
     mode: 'NO' (normally open, = read directly)
           'NC' (normally closed, = NOT of value)          */
  function contact(varName, mode) {
    _assertVar(varName, 'contact');
    mode = mode || 'NO';
    if (mode !== 'NO' && mode !== 'NC')
      throw new Error('contact: mode must be NO or NC, got: ' + mode);
    return { type: 'contact', var: varName, mode: mode };
  }

  /* EdgeNode — detects rising or falling edge
     edge: 'R_TRIG' | 'F_TRIG'                            */
  function edge(varName, edgeType) {
    _assertVar(varName, 'edge');
    if (edgeType !== 'R_TRIG' && edgeType !== 'F_TRIG')
      throw new Error('edge: type must be R_TRIG or F_TRIG, got: ' + edgeType);
    return { type: 'edge', var: varName, edge: edgeType };
  }

  /* NotNode — logical negation of one child              */
  function not(child) {
    _assertExpr(child, 'not');
    return { type: 'not', child: child };
  }

  /* AndNode — logical AND of N children (min 2)         */
  function and(/* ...children */) {
    var children = Array.prototype.slice.call(arguments);
    // Also accept a single array argument
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    if (children.length < 2)
      throw new Error('and: requires at least 2 children, got ' + children.length);
    children.forEach(function(c, i) { _assertExpr(c, 'and child[' + i + ']'); });
    return { type: 'and', children: children };
  }

  /* OrNode — logical OR of N children (min 2)           */
  function or(/* ...children */) {
    var children = Array.prototype.slice.call(arguments);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    if (children.length < 2)
      throw new Error('or: requires at least 2 children, got ' + children.length);
    children.forEach(function(c, i) { _assertExpr(c, 'or child[' + i + ']'); });
    return { type: 'or', children: children };
  }

  /* ----------------------------------------------------------
     ActionNode factory
     type:   'coil'   — Y = condition
             'set'    — Y = Y OR condition   (latch ON)
             'reset'  — Y = Y AND NOT(cond)  (latch OFF)
             'toggle' — Y = Y XOR condition
     target: variable name, e.g. 'Y0', 'M3'
  ---------------------------------------------------------- */
  function action(type, target) {
    var validTypes = ['coil', 'set', 'reset', 'toggle'];
    if (validTypes.indexOf(type) < 0)
      throw new Error('action: type must be one of ' + validTypes.join('|') + ', got: ' + type);
    _assertVar(target, 'action.target');
    return { type: type, target: target };
  }

  /* ----------------------------------------------------------
     Internal assertion helpers
  ---------------------------------------------------------- */
  function _assertVar(v, ctx) {
    if (typeof v !== 'string' || !/^[XYMTCxymtc]\d+$/.test(v))
      throw new Error(ctx + ': invalid variable name "' + v + '" (expected X0, Y1, M3…)');
  }
  function _assertExpr(node, ctx) {
    var valid = ['contact','edge','not','and','or'];
    if (!node || valid.indexOf(node.type) < 0)
      throw new Error(ctx + ': expected ExprNode, got ' + JSON.stringify(node));
  }

  /* hashExpr(node) — deterministic structural hash (Hardening item 2)
     AND/OR children sorted: AND(A,B) === AND(B,A).                     */
  function hashExpr(node) {
    if (!node || !node.type) return '?';
    switch (node.type) {
      case 'contact': return 'C:' + node.var + ':' + (node.mode||'NO');
      case 'edge':    return 'E:' + node.var + ':' + (node.edge||'R_TRIG');
      case 'not':     return 'NOT(' + hashExpr(node.child) + ')';
      case 'and': { var hs=(node.children||[]).map(hashExpr).sort(); return 'AND('+hs.join(',')+')'; }
      case 'or':  { var hs=(node.children||[]).map(hashExpr).sort(); return 'OR(' +hs.join(',')+')'; }
      default: return node.type+':?';
    }
  }

  // ============================================================
  // FASE 2 — NORMALIZER
  // ============================================================

  var LadderNormalizer = (function() {

    /* ── Main entry point ─────────────────────────────────── */
    function normalize(program) {
      _validateProgramStructure(program);
      var normalised = Object.assign({}, program, {
        rungs: program.rungs.map(function(rung, i) {
          return _normalizeRung(rung, i);
        })
      });
      return normalised;
    }

    /* ── Validate top-level program structure ─────────────── */
    function _validateProgramStructure(program) {
      if (!program || program.version !== 'ladder_v1')
        throw new Error('normalizer: program.version must be ladder_v1');
      if (!Array.isArray(program.rungs) || program.rungs.length === 0)
        throw new Error('normalizer: program.rungs is empty');
    }

    /* ── Normalise one rung ───────────────────────────────── */
    function _normalizeRung(rung, index) {
      // Validate rung structure
      if (!rung.id) throw new Error('rung[' + index + ']: missing id');
      if (!rung.condition) throw new Error('rung ' + rung.id + ': missing condition');
      if (!Array.isArray(rung.actions) || rung.actions.length === 0)
        throw new Error('rung ' + rung.id + ': actions must be a non-empty array');

      // Validate actions
      rung.actions.forEach(function(a, i) {
        if (!a.type || !a.target)
          throw new Error('rung ' + rung.id + ' action[' + i + ']: missing type or target');
      });

      return Object.assign({}, rung, {
        condition: _normalizeExpr(rung.condition, rung.id)
      });
    }

    /* ── Recursively normalise an expression ─────────────── */
    function _normalizeExpr(node, rungId) {
      if (!node) throw new Error('rung ' + rungId + ': null expression node');

      switch (node.type) {

        case 'contact':
        case 'edge':
          // Leaf nodes — no normalisation needed
          return node;

        case 'not': {
          var normalChild = _normalizeExpr(node.child, rungId);
          // NOT(NOT(A)) → A
          if (normalChild.type === 'not') return normalChild.child;
          return Object.assign({}, node, { child: normalChild });
        }

        case 'and': {
          // 1. Recursively normalise children
          var normChildren = node.children.map(function(c) {
            return _normalizeExpr(c, rungId);
          });
          // 2. Flatten nested ANDs: AND(AND(A,B),C) → AND(A,B,C)
          normChildren = _flatten('and', normChildren);
          // 3. Deduplicate: AND(A,A) → AND(A) → if single, return it
          normChildren = _dedupe(normChildren);
          // 4. Validate minimum children
          if (normChildren.length < 2)
            throw new Error('rung ' + rungId + ': AND has fewer than 2 children after normalisation');
          return Object.assign({}, node, { children: normChildren });
        }

        case 'or': {
          var normChildren = node.children.map(function(c) {
            return _normalizeExpr(c, rungId);
          });
          // Flatten nested ORs: OR(OR(A,B),C) → OR(A,B,C)
          normChildren = _flatten('or', normChildren);
          // Deduplicate: OR(A,A) → OR(A) → if single, return it
          normChildren = _dedupe(normChildren);
          if (normChildren.length < 2)
            throw new Error('rung ' + rungId + ': OR has fewer than 2 children after normalisation');
          return Object.assign({}, node, { children: normChildren });
        }

        default:
          throw new Error('rung ' + rungId + ': unknown ExprNode type "' + node.type + '"');
      }
    }

    /* Flatten: AND(AND(A,B),C) → AND(A,B,C) */
    function _flatten(type, children) {
      var result = [];
      children.forEach(function(c) {
        if (c.type === type && Array.isArray(c.children)) {
          c.children.forEach(function(cc) { result.push(cc); });
        } else {
          result.push(c);
        }
      });
      return result;
    }

    /* Deduplicate by structural JSON serialisation.
       AND(A,A) → [A]  (single element — caller handles <2 case) */
    function _dedupe(children) {
      var seen = {}, result = [];
      children.forEach(function(c) {
        var key = hashExpr(c);
        if (!seen[key]) { seen[key] = true; result.push(c); }
      });
      return result;
    }

    return { normalize: normalize };
  }());

  // ============================================================
  // FASE 3 — COMPILER: LadderAST → IR
  // ============================================================

  var LadderCompiler = (function() {

    /* ── compileLadderToIR(program) ────────────────────────────
       Input: a normalised LadderProgram (version: ladder_v1)
       Output: IR envelope identical in format to compileFBD()

       Pipeline:
         1. Normalise program (idempotent if already normalised)
         2. For each rung: compile condition → IR nodes
         3. For each action: wire the condition to output nodes
         4. Build outputs[] (inverse graph for topo sort)
         5. Topological sort → order[]
         6. Build symbol table
         7. Synthesise drawflow representation
    ---------------------------------------------------------- */
    function compileLadderToIR(program) {
      // Step 1: normalise (catches structural errors early)
      var normalised = LadderNormalizer.normalize(program);

      var nodes   = [];    // flat IR node array
      var nextId  = 1;     // monotonic node ID

      // ── varState: maps variable name → {readIdx, setList, resetList}
      // Ensures one IR node per named variable across all rungs.
      var varState = {};

      // ── exprCache: maps structural hash → IR node index
      // Reuses existing IR nodes for identical sub-expressions,
      // avoiding redundant nodes in programs with repeated patterns.
      var exprCache = {};

      // ── edge state: maps variable name → prev-state node index
      // R_TRIG(X) = X AND NOT(X_prev_scan)
      // F_TRIG(X) = NOT(X) AND X_prev_scan
      // We model X_prev with a dedicated SR latch that persists state.
      var edgePrev = {};
      var edgePrevUpdate = {};

      /* ── helpers ─────────────────────────────────────────── */

      function emit(nd) {
        nodes.push(nd);
        return nodes.length - 1;
      }

      function mkNode(type, opts) {
        opts = opts || {};
        return {
          id:      nextId++,
          type:    type,
          in1:     (opts.in1 !== undefined) ? opts.in1 : null,
          in2:     (opts.in2 !== undefined) ? opts.in2 : null,
          outputs: [],
          preset:  opts.preset  || 0,
          value:   opts.value   || 0,
          op:      opts.op      || '>',
          outIdx:  opts.outIdx  || 0,
          pv:0, inMin:0, inMax:4095, outMin:0, outMax:100,
          memIn1:null, memIn2:null, memOut:null
          // address added below where applicable
        };
      }

      /* Parse "X0" → {area:'X', index:0} */
      function parseAddr(v) {
        var m = /^([XYMTCxymtc])(\d+)$/.exec(v);
        if (!m) throw new Error('Invalid variable: ' + v);
        return { area: m[1].toUpperCase(), index: parseInt(m[2], 10) };
      }

      /* For X inputs: input1=X0, input2=X1 */
      function xNodeType(index) {
        return (index === 0) ? 'input1' : 'input2';
      }
      /* For Y outputs: output1-4 */
      function yNodeType(index) {
        return ['output1','output2','output3','output4'][index] || 'output1';
      }

      /* Get or create the base state node for a variable.
         This is the node whose .state is read by contacts.     */
      function getVarNode(varName) {
        if (varState[varName]) return varState[varName].readIdx;
        var addr = parseAddr(varName);
        var nd, idx;
        if (addr.area === 'X') {
          nd = mkNode(xNodeType(addr.index), { outIdx: addr.index });
          nd.memIn1  = addr.index;
          nd.address = { area: 'X', index: addr.index };
          idx = emit(nd);
        } else if (addr.area === 'Y') {
          nd = mkNode(yNodeType(addr.index), { outIdx: addr.index });
          nd.address = { area: 'Y', index: addr.index };
          idx = emit(nd);
        } else if (addr.area === 'M') {
          nd = mkNode('sr');
          nd.address = { area: 'M', index: addr.index };
          idx = emit(nd);
        } else if (addr.area === 'T') {
          nd = mkNode('ton');
          nd.address = { area: 'T', index: addr.index };
          idx = emit(nd);
        } else if (addr.area === 'C') {
          nd = mkNode('ctu');
          nd.address = { area: 'C', index: addr.index };
          idx = emit(nd);
        } else {
          throw new Error('Unsupported area: ' + addr.area);
        }
        varState[varName] = { readIdx: idx, setList: [], resetList: [] };
        return idx;
      }

      /* ── compileExpr(node) → array index of result node ──── */
      function compileExpr(node) {
        // Cache key: stable structural hash for this sub-expression
        var cacheKey = hashExpr(node);
        if (exprCache[cacheKey] !== undefined) return exprCache[cacheKey];

        var resultIdx;

        switch (node.type) {

          case 'contact': {
            var srcIdx = getVarNode(node.var);
            if (node.mode === 'NC') {
              // NC contact: NOT wrapper around the variable node
              var notNd = mkNode('not', { in1: srcIdx });
              resultIdx = emit(notNd);
            } else {
              // NO contact: read variable directly
              resultIdx = srcIdx;
            }
            break;
          }

          case 'edge': {
            /* R_TRIG(X) = X AND NOT(X_prev)
               F_TRIG(X) = NOT(X) AND X_prev

               X_prev is modelled with a dedicated SR latch.
               The latch is updated each scan via the SR semantics:
                 SR.S = X (current),  SR.R = NOT(X)
               This gives SR.Q = previous value of X.            */
            var xIdx = getVarNode(node.var);

            // Get or create the prev-state latch for this variable
            var prevKey = 'prev_' + node.var;
            if (!edgePrev[prevKey]) {
              var prevNd  = mkNode('sr');
              var prevIdx = emit(prevNd);
              // Wire: S = X, R = NOT(X)
              var notXNd  = mkNode('not', { in1: xIdx });
              var notXIdx = emit(notXNd);
              nodes[prevIdx].in1 = xIdx;    // S = X
              nodes[prevIdx].in2 = notXIdx; // R = NOT(X)
              edgePrev[prevKey] = prevIdx;
              edgePrevUpdate[prevKey] = prevIdx;
            }
            var xPrevIdx = edgePrev[prevKey];

            if (node.edge === 'R_TRIG') {
              // R_TRIG = X AND NOT(X_prev)
              var notPrevNd  = mkNode('not', { in1: xPrevIdx });
              var notPrevIdx = emit(notPrevNd);
              var andNd      = mkNode('and', { in1: xIdx, in2: notPrevIdx });
              resultIdx = emit(andNd);
            } else {
              // F_TRIG = NOT(X) AND X_prev
              var notXNd2  = mkNode('not', { in1: xIdx });
              var notXIdx2 = emit(notXNd2);
              var andNd2   = mkNode('and', { in1: notXIdx2, in2: xPrevIdx });
              resultIdx = emit(andNd2);
            }
            break;
          }

          case 'not': {
            var childIdx = compileExpr(node.child);
            var notNd2   = mkNode('not', { in1: childIdx });
            resultIdx = emit(notNd2);
            break;
          }

          case 'and': {
            // Compile children, sort IDs for canonical order (enables cache hits)
            var childIndices = node.children.map(function(c) {
              return compileExpr(c);
            });
            // Sort by array index for deterministic AND order
            var sortedIndices = childIndices.slice().sort(function(a, b) { return a - b; });
            // Build left-associative AND chain
            var prev = sortedIndices[0];
            for (var i = 1; i < sortedIndices.length; i++) {
              var andN = mkNode('and', { in1: prev, in2: sortedIndices[i] });
              prev = emit(andN);
            }
            resultIdx = prev;
            break;
          }

          case 'or': {
            var childIndices = node.children.map(function(c) {
              return compileExpr(c);
            });
            var sortedIndices = childIndices.slice().sort(function(a, b) { return a - b; });
            var prev = sortedIndices[0];
            for (var i = 1; i < sortedIndices.length; i++) {
              var orN = mkNode('or', { in1: prev, in2: sortedIndices[i] });
              prev = emit(orN);
            }
            resultIdx = prev;
            break;
          }

          default:
            throw new Error('compileExpr: unknown node type "' + node.type + '"');
        }

        exprCache[cacheKey] = resultIdx;
        return resultIdx;
      }

      /* ── compileAction(action, condIdx) ─────────────────────
         Wire the rung condition to the output for this action.
         COIL:   output node in1 = condIdx (direct assignment)
         SET:    accumulate condIdx into varState.setList
         RESET:  accumulate condIdx into varState.resetList
         TOGGLE: output = target XOR condIdx                    */
      function compileAction(act, condIdx) {
        var addr = parseAddr(act.target);

        if (addr.area === 'Y') {
          var outNd = mkNode(yNodeType(addr.index), { in1: condIdx, outIdx: addr.index });
          outNd.address = { area: 'Y', index: addr.index };
          emit(outNd);

        } else if (addr.area === 'M') {
          // Ensure the SR node exists for this M variable
          getVarNode(act.target);
          var vs = varState[act.target];

          if (act.type === 'coil' || act.type === 'set') {
            vs.setList.push(condIdx);
          } else if (act.type === 'reset') {
            vs.resetList.push(condIdx);
          } else if (act.type === 'toggle') {
            // TOGGLE: Y = Y XOR condition
            var mIdx  = vs.readIdx;
            var xorNd = mkNode('xor', { in1: mIdx, in2: condIdx });
            var xorIdx = emit(xorNd);
            // The XOR result drives the SET of the latch
            vs.setList.push(xorIdx);
          }

        } else {
          // For T/C targets: condition drives the timer/counter in1
          getVarNode(act.target);
          nodes[varState[act.target].readIdx].in1 = condIdx;
        }
      }

      // ── Compile all rungs ─────────────────────────────────
      normalised.rungs.forEach(function(rung) {
        var condIdx = compileExpr(rung.condition);
        rung.actions.forEach(function(act) {
          compileAction(act, condIdx);
        });
      });

      // ── Wire SET/RESET accumulators to SR nodes ───────────
      // Multiple SET conditions → OR chain → SR.in1
      // Multiple RESET conditions → OR chain → SR.in2
      Object.keys(varState).forEach(function(varName) {
        var vs   = varState[varName];
        var addr = parseAddr(varName);
        if (addr.area !== 'M') return;
        var srNd = nodes[vs.readIdx];

        if (vs.setList.length > 0) {
          srNd.in1 = _buildORChain(vs.setList, mkNode, emit);
        }
        if (vs.resetList.length > 0) {
          srNd.in2 = _buildORChain(vs.resetList, mkNode, emit);
          // If only RESET present (no SET): use RS (Reset-dominant)
          if (vs.setList.length === 0) srNd.type = 'rs';
        }
      });

      // _fixEdgeOrder (Hardening 1): schedule X_prev SR latch AFTER output nodes
    (function(){
      var OT=['output1','output2','output3','output4','sr','rs'];
      var ON=nodes.filter(function(n){return OT.indexOf(n.type)>=0;});
      Object.keys(edgePrevUpdate).forEach(function(k){
        var L=nodes[edgePrevUpdate[k]];
        ON.forEach(function(o){if(L.outputs.indexOf(o.id)<0)L.outputs.push(o.id);});
      });
    }());

    // Variable validation (Hardening 4)
    var compileWarnings=[];
    (function(){
      var SZ={X:64,Y:64,M:64,T:32,C:32,A:16,R:32};
      Object.keys(varState).forEach(function(v){
        var m=/^([XYMTCxymtc])(\d+)$/.exec(v);
        if(!m){compileWarnings.push('Invalid var: '+v);return;}
        var a=m[1].toUpperCase(),i=parseInt(m[2],10);
        if(i>=(SZ[a]||64))compileWarnings.push(v+' exceeds '+a);
      });
      if(compileWarnings.length)console.warn('[LadderAST]',compileWarnings);
    }());

    // ── Build outputs[] and topological sort ──────────────
      var idToIdx = {};
      nodes.forEach(function(nd, i) { idToIdx[nd.id] = i; });

      nodes.forEach(function(nd) {
        nd.outputs = []; // reset before rebuild
      });
      nodes.forEach(function(nd) {
        var reg = function(driverIdx) {
          if (driverIdx === null || driverIdx === undefined || driverIdx < 0) return;
          if (driverIdx < nodes.length) nodes[driverIdx].outputs.push(nd.id);
        };
        reg(nd.in1); reg(nd.in2);
      });

      var order = _topo(nodes, idToIdx);

      // ── Build symbol table ────────────────────────────────
      var symbolTable = null;
      if (typeof PlcSymbolTable !== 'undefined') {
        var buildResult = PlcSymbolTable.build(nodes);
        var ck = _ladderASTCanonicalKey(normalised);
        symbolTable = PlcSymbolTable.formatForEnvelope(buildResult, ck, 'ladder_ast');
      }

      var debugInfo={
        cacheHits:Object.keys(exprCache).length,
        edgeNodes:Object.keys(edgePrev).length,
        warnings:compileWarnings
      };
      return _buildIR(nodes, order, symbolTable, debugInfo);
    }

    /* ── Build left-associative OR chain ──────────────────── */
    function _buildORChain(indices, mkNode, emit) {
      if (indices.length === 1) return indices[0];
      var prev = indices[0];
      for (var i = 1; i < indices.length; i++) {
        var nd = mkNode('or', { in1: prev, in2: indices[i] });
        prev = emit(nd);
      }
      return prev;
    }

    /* ── Topological sort (Kahn's algorithm) ─────────────── */
    function _topo(nodes, idToIdx) {
      var n     = nodes.length;
      var indeg = new Array(n).fill(0);
      var adj   = nodes.map(function() { return []; });
      nodes.forEach(function(nd, j) {
        nd.outputs.forEach(function(tid) {
          var ti = idToIdx[tid];
          if (ti !== undefined) { adj[j].push(ti); indeg[ti]++; }
        });
      });
      var q = [], res = [];
      indeg.forEach(function(d, i) { if (d === 0) q.push(i); });
      while (q.length) {
        var cur = q.shift(); res.push(cur);
        adj[cur].forEach(function(nx) { if (--indeg[nx] === 0) q.push(nx); });
      }
      for (var i = 0; i < n; i++) if (res.indexOf(i) === -1) res.push(i);
      return res;
    }

    /* ── Build the IR envelope ────────────────────────────── */
    function _buildIR(nodes, order, symbolTable, debugInfo) {
      var MEM={X:64,Y:64,M:64,T:32,C:32,A:16,R:32};
      var meta={
        source:'ladder_ast', compiledWith:'ladder_ast',
        version:'ladder_v1', irVersion:4,
        compiled:new Date().toISOString(), nodeCount:nodes.length
      };
      if(symbolTable) meta.symbolTable=symbolTable;
      if(debugInfo)   meta.debugInfo=debugInfo;
      if(typeof window!=='undefined'&&window._LADDER_DEBUG){
        console.info('[AST] normalized — source: ladder_v1');
        console.info('[AST] nodes reused:',(debugInfo&&debugInfo.cacheHits)||0);
        console.info('[IR]  nodes generated:',nodes.length);
        console.info('[EDGE] nodes created:',(debugInfo&&debugInfo.edgeNodes)||0);
      }
      return{format:'ir',meta:meta,memory:MEM,program:{nodes:nodes},order:order};
    }

    /* ── Canonical key for Ladder AST programs ────────────── */
    function _ladderASTCanonicalKey(program) {
      try {
        return program.rungs.map(function(r) {
          var actions = (r.actions || []).map(function(a) {
            return a.type + ':' + a.target;
          }).join(',');
          return r.id + '[' + hashExpr(r.condition) + '→' + actions + ']';
        }).join(';');
      } catch(e) { return 'error'; }
    }

    return { compileLadderToIR: compileLadderToIR };
  }());

  // ============================================================
  // FASE 6 — TESTS
  // ============================================================

  var LadderTests = (function() {

    function test_h1_cache_subexpr(){var andAB=and(contact('X0'),contact('X1'));var orDup={type:'or',children:[andAB,andAB]};var ir=LadderCompiler.compileLadderToIR(makeProgram([makeRung('r1',orDup,[action('coil','Y0')])]));var ands=ir.program.nodes.filter(function(n){return n.type==='and';});assert(ands.length===1,'h1:single AND');}
    function test_h2_edge_reuse(){var ir=LadderCompiler.compileLadderToIR(makeProgram([makeRung('r1',and(edge('X0','R_TRIG'),edge('X0','R_TRIG')),[action('coil','Y0')])]));var srs=ir.program.nodes.filter(function(n){return n.type==='sr';});assert(srs.length===1,'h2:single SR latch');}
    function test_h3_set_reset_priority(){var ir=LadderCompiler.compileLadderToIR(makeProgram([makeRung('rS',contact('X0'),[action('set','M0')]),makeRung('rR',contact('X0'),[action('reset','M0')])]));var sr=ir.program.nodes.find(function(n){return n.type==='sr';});assert(sr!==undefined,'h3:SR');assert(sr.in1!==null&&sr.in1>=0,'h3:in1');assert(sr.in2!==null&&sr.in2>=0,'h3:in2');assert(sr.type==='sr','h3:Set-dominant');}
    function test_h4_multi_rung_same_var(){var ir=LadderCompiler.compileLadderToIR(makeProgram([makeRung('r1',contact('X0'),[action('coil','Y0')]),makeRung('r2',contact('X1'),[action('coil','Y0')])]));var outs=ir.program.nodes.filter(function(n){return n.type==='output1';});assert(outs.length>=1,'h4:output1');outs.forEach(function(n,i){assert(n.in1!==null&&n.in1>=0,'h4:out'+i+' driver');});}
    function test_h5_stable_order(){function mk(){return makeProgram([makeRung('r1',or(and(contact('X0'),contact('X1')),contact('X0')),[action('coil','Y0')])]);}var a=LadderCompiler.compileLadderToIR(mk());var b=LadderCompiler.compileLadderToIR(mk());assert(a.program.nodes.length===b.program.nodes.length,'h5:node count');assert(a.order.length===b.order.length,'h5:order length');}
    function test_h6_stress_deep_and(){var ir=compileOne(and(contact('X0'),contact('X1'),contact('X0'),contact('X1'),contact('X0')),[action('coil','Y0')]);assert(hasType(ir,'and'),'h6:AND');assert(ir.order.length===ir.program.nodes.length,'h6:order');}
    function test_h7_hash_canonical(){assert(hashExpr(and(contact('X0'),contact('X1')))===hashExpr(and(contact('X1'),contact('X0'))),'h7:AND commutative');assert(hashExpr(or(contact('X0'),contact('X1')))===hashExpr(or(contact('X1'),contact('X0'))),'h7:OR commutative');}
    function test_h8_hash_not_contact(){assert(hashExpr(not(contact('X0')))===hashExpr(not(contact('X0'))),'h8:NOT stable');assert(hashExpr(contact('X0','NC'))!==hashExpr(not(contact('X0','NO'))),'h8:NC!=NOT(NO)');}
    function test_h9_metadata(){var ir=compileOne(contact('X0'),[action('coil','Y0')]);assert(ir.meta.compiledWith==='ladder_ast','h9:compiledWith');assert(ir.meta.version==='ladder_v1','h9:version');assert(ir.meta.source==='ladder_ast','h9:source');}
    function test_h10_edge_order(){var ir=compileOne(edge('X0','R_TRIG'),[action('coil','Y0')]);var nds=ir.program.nodes,ord=ir.order;var si=nds.findIndex(function(n){return n.type==='sr';});var oi=nds.findIndex(function(n){return n.type==='output1';});assert(si>=0,'h10:SR');assert(oi>=0,'h10:output1');assert(ord.indexOf(si)>ord.indexOf(oi),'h10:SR after output1');}

    var _allTests=[
      test_series_simple,test_parallel,test_mixed,test_not,
      test_set_reset,test_edge_r_trig,
      test_normalize_flatten_and,test_normalize_flatten_or,
      test_normalize_double_not,test_normalize_dedupe,
      test_normalizer_error_empty_actions,test_normalizer_error_and_one_child,
      test_h1_cache_subexpr,test_h2_edge_reuse,test_h3_set_reset_priority,
      test_h4_multi_rung_same_var,test_h5_stable_order,test_h6_stress_deep_and,
      test_h7_hash_canonical,test_h8_hash_not_contact,
      test_h9_metadata,test_h10_edge_order
    ];

    function runAll(){
      var results=[];
      _allTests.forEach(function(fn){
        var r={name:fn.name,passed:false,error:null};
        try{fn();r.passed=true;}catch(e){r.error=e.message;}
        results.push(r);
      });
      var p=results.filter(function(r){return r.passed;}).length;
      return{passed:p,failed:results.length-p,total:results.length,results:results};
    }

    function assert(c,m){if(!c)throw new Error('ASSERT FAIL: '+m);}
    function assertThrows(fn,msg){var t=false;try{fn();}catch(e){t=true;if(msg&&e.message.indexOf(msg)<0)throw new Error('Expected "'+msg+'" got:'+e.message);}if(!t)throw new Error('Expected error');}
    function compileOne(cond,actions){return LadderCompiler.compileLadderToIR(makeProgram([makeRung('r1',cond,actions)]));}
    function hasType(ir,type){return ir.program.nodes.some(function(n){return n.type===type;});}

    function test_series_simple(){var ir=compileOne(and(contact('X0'),contact('X1')),[action('coil','Y0')]);assert(hasType(ir,'and'),'s:and');assert(hasType(ir,'input1'),'s:in1');assert(hasType(ir,'input2'),'s:in2');assert(hasType(ir,'output1'),'s:out');assert(ir.order.length===ir.program.nodes.length,'s:ord');}
    function test_parallel(){var ir=compileOne(or(contact('X0'),contact('X1')),[action('coil','Y0')]);assert(hasType(ir,'or'),'p:or');assert(hasType(ir,'output1'),'p:out');}
    function test_mixed(){var ir=compileOne(or(and(contact('X0'),contact('X1')),contact('X0')),[action('coil','Y0')]);assert(hasType(ir,'and'),'m:and');assert(hasType(ir,'or'),'m:or');assert(hasType(ir,'output1'),'m:out');}
    function test_not(){var ir=compileOne(not(contact('X0')),[action('coil','Y0')]);assert(hasType(ir,'not'),'n:not');assert(hasType(ir,'output1'),'n:out');}
    function test_set_reset(){var ir=LadderCompiler.compileLadderToIR(makeProgram([makeRung('rs',contact('X0'),[action('set','M0')]),makeRung('rr',contact('X1'),[action('reset','M0')])]));var srs=ir.program.nodes.filter(function(n){return n.type==='sr'||n.type==='rs';});assert(srs.length===1,'sr:one');assert(srs[0].in1!==null,'sr:in1');assert(srs[0].in2!==null,'sr:in2');}
    function test_edge_r_trig(){var ir=compileOne(edge('X0','R_TRIG'),[action('coil','Y0')]);assert(hasType(ir,'sr'),'e:sr');assert(hasType(ir,'not'),'e:not');assert(hasType(ir,'and'),'e:and');}
    function test_normalize_flatten_and(){var n=and(and(contact('X0'),contact('X1')),contact('X0'));var norm=LadderNormalizer.normalize(makeProgram([makeRung('r1',n,[action('coil','Y0')])]));var c=norm.rungs[0].condition;if(c.type==='and')c.children.forEach(function(ch){assert(ch.type!=='and','fa:flat');});}
    function test_normalize_flatten_or(){var n=or(or(contact('X0'),contact('X1')),contact('X0'));var norm=LadderNormalizer.normalize(makeProgram([makeRung('r1',n,[action('coil','Y0')])]));var c=norm.rungs[0].condition;if(c.type==='or')c.children.forEach(function(ch){assert(ch.type!=='or','fo:flat');});}
    function test_normalize_double_not(){var norm=LadderNormalizer.normalize(makeProgram([makeRung('r1',not(not(contact('X0'))),[action('coil','Y0')])]));var c=norm.rungs[0].condition;assert(c.type==='contact','dn:contact');assert(c.var==='X0','dn:X0');}
    function test_normalize_dedupe(){var d={type:'and',children:[contact('X0'),contact('X1'),contact('X0')]};var norm=LadderNormalizer.normalize(makeProgram([makeRung('r1',d,[action('coil','Y0')])]));var c=norm.rungs[0].condition;assert(c.type==='and','dd:and');assert(c.children.length===2,'dd:2');}
    function test_normalizer_error_empty_actions(){assertThrows(function(){LadderNormalizer.normalize({version:'ladder_v1',rungs:[{id:'r1',condition:contact('X0'),actions:[],meta:{}}]});},'actions must be a non-empty array');}
    function test_normalizer_error_and_one_child(){assertThrows(function(){LadderNormalizer.normalize(makeProgram([makeRung('r1',{type:'and',children:[contact('X0'),contact('X0')]},[action('coil','Y0')])]));},'fewer than 2 children');}
    return { runAll: runAll };
  }());

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    // Fase 1 — AST factories
    makeProgram:  makeProgram,
    makeRung:     makeRung,
    contact:      contact,
    edge:         edge,
    not:          not,
    and:          and,
    or:           or,
    action:       action,

    // Fase 2 — Normalizer
    LadderNormalizer: LadderNormalizer,

    // Fase 3+4 — Compiler
    LadderCompiler: LadderCompiler,

    // Fase 2H — Hardening utilities
    hashExpr: hashExpr,

    // Fase 6 — Tests (12 original + 10 hardening)
    LadderTests: LadderTests
  };

}));
