/* =============================================================
   PLC-CORE-MDE — Ladder Decompiler  v1.0
   /js/compiler/ladder_decompiler.js
   =============================================================
   Convierte un IR compilado (desde FBD o Ladder) de vuelta a
   un programa Ladder editable en ladder.html.

   CONTRATO DE DATOS
   ─────────────────
   Entrada (IR envelope):
     {
       format:  'ir',
       program: { nodes: PlcNode[] },
       order:   number[],          // índices topológicos
       memory:  { X,Y,M,T,C,A,R }
     }

   Cada PlcNode del IR tiene:
     id, type, in1, in2, outputs[], preset, value, address:{area,index}

   Salida de decompileIRToLadder:
     Array de rungs en formato paths (compatible con ladder.html):
     [{ id, comment, paths:[[elem,...]], outputs:[coil,...] }]
     elem = { type:'CONTACT', var:'X0', negated:bool }
     coil = { type:'COIL',    var:'Y0', mode:'NORMAL'|'SET'|'RESET' }

   FLUJO INTERNO
   ─────────────
   analyzeIR → detectEdgePatterns → buildExprTree (backward slice)
   → expandXOR → pushDownNOT → distributeAND (SOP, límite 32 términos)
   → flattenSOP → emitRungs (1 término SOP = 1 rung)

   REGLAS CRÍTICAS
   ───────────────
   ❌ NO modifica plc_runtime.cpp ni ningún archivo C++
   ❌ NO altera el formato IR
   ❌ NO rompe FBD existente
   ✅ Si IR no convertible → retorna null con análisis, nunca lanza
   ✅ Compatible con window.LadderProgram si está cargado (opcional)
   =============================================================
*/
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LadderDecompiler = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================
  // CONSTANTES
  // ============================================================

  var MAX_SOP_TERMS = 32;

  // Nivel de convertibilidad por tipo de nodo IR (v2: Ladder con [P]/[N], CMP,
  // BLINK, SCALE/PWM, reset de CTU, carga de CTD y Q de bloques reutilizable)
  var NODE_LEVEL = {
    input1: 1, input2: 1,
    output1: 1, output2: 1, output3: 1, output4: 1,
    and: 1, or: 1, not: 1,
    r_trig: 1, f_trig: 1,
    ton: 1, tof: 1, tp: 1, blink: 1,
    ctu: 1, ctd: 1,
    sr: 1, rs: 1,
    cmp: 1, analog1: 1, scale: 1, pwm: 1,
    // Nivel 2 — requiere expansión (equivalente exacto)
    xor: 2
  };

  var LEVEL3_REASON = {};

  var LEVEL2_REASON = {
    xor: 'XOR expanded to OR(AND(A,NOT(B)),AND(NOT(A),B))'
  };

  var OUTPUT_TYPES = {
    output1: true, output2: true, output3: true, output4: true,
    sr: true, rs: true
  };

  var BLOCK_IR_TYPES = {
    ton: 'TON', tof: 'TOF', tp: 'TP', blink: 'BLINK', ctu: 'CTU', ctd: 'CTD'
  };

  // ============================================================
  // TAREA 1-A: analyzeIR
  // ============================================================

  /**
   * analyzeIR(ir) → { convertible, level, warnings, nodeReport }
   *
   * Clasifica cada nodo del IR.
   * level = máximo nivel encontrado.
   * convertible = false si level === 3 o hay ciclos.
   */
  function analyzeIR(ir) {
    if (!ir || !ir.program || !Array.isArray(ir.program.nodes)) {
      return { convertible: false, level: 3,
               warnings: ['Invalid IR: missing program.nodes'],
               nodeReport: {} };
    }

    var nodes    = ir.program.nodes;
    var warnings = [];
    var nodeReport = {};
    var maxLevel = 1;

    function bad(nd, msg) {
      maxLevel = 3;
      warnings.push('Node ' + nd.id + ' (' + nd.type + '): ' + msg);
      if (nodeReport[nd.id]) { nodeReport[nd.id].level = 3; nodeReport[nd.id].reason = msg; }
    }
    function src(k) { return (k !== null && k !== undefined && k >= 0 && k < nodes.length) ? nodes[k] : null; }
    function isNum(n) { return n && (n.type === 'analog1' || n.type === 'scale'); }

    nodes.forEach(function (nd) {
      var lvl = NODE_LEVEL[nd.type];
      if (lvl === undefined) {
        lvl = 3;
        warnings.push('Unknown node type "' + nd.type + '" (id=' + nd.id + ')');
      }
      var reason = lvl === 3 ? (LEVEL3_REASON[nd.type] || 'Non-convertible: ' + nd.type)
                 : lvl === 2 ? (LEVEL2_REASON[nd.type] || 'Requires expansion: ' + nd.type)
                 : '';
      nodeReport[nd.id] = { level: lvl, reason: reason, type: nd.type };
      if (lvl > maxLevel) maxLevel = lvl;
      if (lvl === 3) warnings.push('Node ' + nd.id + ' (' + nd.type + '): ' + reason);
    });

    var pwmOut = {};
    nodes.forEach(function (nd) {
      var a = src(nd.in1), b = src(nd.in2);
      if (nd.type === 'sr' && a && b && b.type === 'not' && b.in1 === nd.in1)
        bad(nd, 'legacy one-scan register SR(S=X,R=NOT X) has no Ladder equivalent');
      if ((nd.type === 'and') && (!a || !b))
        bad(nd, 'AND with an unconnected input (always false) cannot be shown as a contact chain');
      if (nd.type === 'not' && !a) bad(nd, 'NOT with an unconnected input');
      if ((nd.type === 'or' || nd.type === 'xor') && !a && !b) bad(nd, nd.type.toUpperCase() + ' without inputs');
      if ((nd.type === 'r_trig' || nd.type === 'f_trig') && !a) bad(nd, 'edge detector without input');
      if (nd.type === 'cmp') {
        if (!isNum(a)) bad(nd, 'CMP input 1 must come from AI1 or SCALE (a boolean source is not expressible)');
        if (nd.in2 !== null && nd.in2 !== undefined && nd.in2 >= 0 && !isNum(b))
          bad(nd, 'CMP input 2 must come from AI1 or SCALE');
        if (['>', '<', '>=', '<=', '==', '!='].indexOf(nd.op || '>') < 0) bad(nd, 'CMP operator not valid: ' + nd.op);
      }
      if (nd.type === 'scale' && !isNum(a)) bad(nd, 'SCALE input must come from AI1 or another SCALE');
      if (nd.type === 'pwm') {
        if (!a) bad(nd, 'PWM without input (fixed duty) has no Ladder element');
        var o = nd.outIdx | 0;
        if (pwmOut[o]) bad(nd, 'two PWM nodes drive the same output (PWM' + (o + 1) + ')');
        pwmOut[o] = true;
      }
      if (!isNum(a) && nd.in1 !== null && nd.in1 !== undefined && nd.in1 >= 0 && nd.type !== 'cmp' && nd.type !== 'pwm' && nd.type !== 'scale') {
        // una fuente numérica conectada a una entrada booleana: el firmware usa
        // state (AI1 > 2048, SCALE > 0), no es un contacto -> no se convierte
      }
      [a, b].forEach(function (s, ix) {
        if (s && isNum(s) && nd.type !== 'cmp' && nd.type !== 'pwm' && nd.type !== 'scale')
          bad(nd, 'a numeric source (' + s.type + ') drives a boolean input (port ' + (ix + 1) + '); implicit threshold has no Ladder element');
      });
    });

    // Realimentación (E4c). Criterio estructural, basado en cómo el motor ordena un lazo:
    // el pivote de cada componente cíclico es su bloque con memoria de menor ID y sus
    // aristas salientes dentro del componente leen el estado del scan anterior.
    //  - 0 bloques con memoria  -> lazo combinacional: se rechaza.
    //  - 1 bloque con memoria y el resto acíclico al cortarlo -> semántica independiente
    //    de los ID: admisible (se valida de nuevo sobre el Ladder recompilado).
    //  - >=2 bloques con memoria -> el retardo depende de los ID internos: se rechaza.
    var loops = _analyzeLoops(nodes);
    if (loops.length) {
      var rej = [];
      loops.forEach(function (lp) {
        if (lp.memCount === 0)
          rej.push('Combinational feedback loop (node ids: ' + lp.ids.join(',') + ') without a memory block: its value depends on the evaluation order.');
        else if (lp.memCount >= 2)
          rej.push('Feedback loop (node ids: ' + lp.ids.join(',') + ') with ' + lp.memCount + ' memory blocks (' + lp.memTypes.join('+') +
            '): the FBD behaviour depends on the evaluation order, which is tied to the internal node identifiers, so no Ladder can reproduce it in general.');
        else if (!lp.acyclicAfterCut)
          rej.push('Feedback loop (node ids: ' + lp.ids.join(',') + ') keeps a cycle after cutting its single memory block: evaluation order cannot be guaranteed.');
      });
      if (rej.length) { maxLevel = 3; rej.forEach(function (m) { warnings.push('Feedback loop detected: ' + m + ' Rewrite the feedback with an SR/RS latch (S/R inputs) so the program can be converted.'); }); }
      else warnings.push('Feedback loop(s) with a single memory block (' + loops.map(function (l) { return l.memTypes[0]; }).join(', ') +
        '): convertible only if the structural validation of the regenerated Ladder succeeds.');
    }

    return {
      convertible: maxLevel < 3,
      level:       maxLevel,
      warnings:    warnings,
      nodeReport:  nodeReport
    };
  }


  var MEM_TYPES = { ton:1, tof:1, tp:1, blink:1, ctu:1, ctd:1, sr:1, rs:1, r_trig:1, f_trig:1 };

  /* Componentes fuertemente conexos con lazo (Tarjan) sobre aristas fuente->consumidor.
     Devuelve por cada uno: ids, memCount, memTypes, acyclicAfterCut (cortando las
     aristas salientes del bloque con memoria único, como hace el motor). */
  function _analyzeLoops(nodes) {
    var n = nodes.length, adj = nodes.map(function () { return []; });
    nodes.forEach(function (nd, i) {
      [nd.in1, nd.in2].forEach(function (k) { if (k !== null && k !== undefined && k >= 0 && k < n) adj[k].push(i); });
    });
    var idx = new Array(n).fill(-1), low = new Array(n).fill(0), on = new Array(n).fill(false), st = [], cnt = 0, comps = [];
    function visit(v) {
      idx[v] = low[v] = cnt++; st.push(v); on[v] = true;
      adj[v].forEach(function (w) {
        if (idx[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); }
        else if (on[w]) low[v] = Math.min(low[v], idx[w]);
      });
      if (low[v] === idx[v]) { var c = [], w; do { w = st.pop(); on[w] = false; c.push(w); } while (w !== v); comps.push(c); }
    }
    for (var i = 0; i < n; i++) if (idx[i] < 0) visit(i);
    var out = [];
    comps.forEach(function (c) {
      var self = c.length === 1 && adj[c[0]].indexOf(c[0]) >= 0;
      if (c.length < 2 && !self) return;
      var inC = {}; c.forEach(function (v) { inC[v] = true; });
      var mem = c.filter(function (v) { return MEM_TYPES[nodes[v].type]; });
      var acyc = false;
      if (mem.length === 1) {
        // Kahn dentro del componente sin las aristas salientes del bloque con memoria
        var indeg = {}; c.forEach(function (v) { indeg[v] = 0; });
        c.forEach(function (v) { if (v === mem[0]) return; adj[v].forEach(function (w) { if (inC[w]) indeg[w]++; }); });
        var q = c.filter(function (v) { return indeg[v] === 0; }), seen = 0;
        while (q.length) { var u = q.pop(); seen++; if (u === mem[0]) continue; adj[u].forEach(function (w) { if (inC[w] && --indeg[w] === 0) q.push(w); }); }
        acyc = seen === c.length;
      }
      out.push({ idxs: c, ids: c.map(function (v) { return nodes[v].id; }).sort(function (a, b) { return a - b; }),
                 memCount: mem.length, memTypes: mem.map(function (v) { return nodes[v].type; }), mem: mem, acyclicAfterCut: acyc });
    });
    return out;
  }

  /* Firma estructural de los lazos: tipo + parámetros del único bloque con memoria. */
  function _loopSignature(nodes) {
    return _analyzeLoops(nodes).map(function (lp) {
      if (lp.memCount !== 1 || !lp.acyclicAfterCut) return 'INVALID';
      var m = nodes[lp.mem[0]];
      return [m.type, m.preset | 0, m.op || ''].join(':');
    }).sort();
  }

  var LEAF_READ_TYPES = { output1:1, output2:1, output3:1, output4:1, sr:1, rs:1, ton:1, tof:1, tp:1, blink:1, ctu:1, ctd:1 };

  function _detectCycles(nodes, strict) {
    var n     = nodes.length;
    var adj   = nodes.map(function () { return []; });
    nodes.forEach(function (nd, i) {
      [nd.in1, nd.in2].forEach(function (src) {
        if (src === null || src === undefined || src < 0 || src >= n) return;
        // Leer una salida Y, una memoria o un bloque es leer una variable
        // (se decompila como contacto): esa arista no forma lazo combinacional.
        if (!strict && LEAF_READ_TYPES[nodes[src].type]) return;
        adj[src].push(i);
      });
    });
    var WHITE = 0, GRAY = 1, BLACK = 2;
    var color = new Array(n).fill(WHITE);
    var cycleIds = [], found = false;
    function dfs(u) {
      color[u] = GRAY;
      adj[u].forEach(function (v) {
        if (found) return;
        if (color[v] === GRAY) { found = true; cycleIds.push(nodes[u].id, nodes[v].id); }
        else if (color[v] === WHITE) dfs(v);
      });
      color[u] = BLACK;
    }
    for (var i = 0; i < n; i++) { if (!found && color[i] === WHITE) dfs(i); }
    return { hasCycle: found, ids: cycleIds };
  }

  // ============================================================
  // TAREA 1-B: Detección de patrones EDGE
  // ============================================================

  /**
   * _detectEdgePatterns(nodes) → { [andIdx]: {type,signalIdx} }
   *
   * Patrón R_TRIG: AND(X, NOT(sr_prev))  donde sr_prev.in1===X y sr_prev.in2===NOT(X)
   * Patrón F_TRIG: AND(NOT(X), sr_prev)  donde sr_prev.in1===X y sr_prev.in2===NOT(X)
   */
  function _detectEdgePatterns(nodes) {
    var edgeMap = {};

    // NOT map: idx → in1 source
    var notSource = {};
    nodes.forEach(function (nd, i) {
      if (nd.type === 'not' && nd.in1 !== null && nd.in1 >= 0) notSource[i] = nd.in1;
    });

    // SR prev-latch fingerprint: sr.in2 must be NOT(sr.in1)
    var srPrevOf = {}; // srIdx → signalIdx
    nodes.forEach(function (nd, i) {
      if (nd.type !== 'sr' && nd.type !== 'rs') return;
      if (nd.in1 === null || nd.in2 === null) return;
      if (notSource[nd.in2] === nd.in1) srPrevOf[i] = nd.in1;
    });

    nodes.forEach(function (nd, i) {
      if (nd.type !== 'and') return;
      var a = nd.in1, b = nd.in2;
      if (a === null || b === null) return;

      // R_TRIG: AND(X, NOT(srPrev))
      if (notSource[b] !== undefined && srPrevOf[notSource[b]] === a) {
        edgeMap[i] = { type: 'R_TRIG', signalIdx: a }; return;
      }
      // R_TRIG alt: AND(NOT(srPrev), X)
      if (notSource[a] !== undefined && srPrevOf[notSource[a]] === b) {
        edgeMap[i] = { type: 'R_TRIG', signalIdx: b }; return;
      }
      // F_TRIG: AND(NOT(X), srPrev)
      if (notSource[a] !== undefined && srPrevOf[b] === notSource[a]) {
        edgeMap[i] = { type: 'F_TRIG', signalIdx: notSource[a] }; return;
      }
      // F_TRIG alt: AND(srPrev, NOT(X))
      if (notSource[b] !== undefined && srPrevOf[a] === notSource[b]) {
        edgeMap[i] = { type: 'F_TRIG', signalIdx: notSource[b] };
      }
    });

    return edgeMap;
  }

  function _addrStr(nd) {
    if (!nd) return 'X0';
    if (nd.address) return nd.address.area + nd.address.index;
    if (nd.type === 'input1') return 'X0';
    if (nd.type === 'input2') return 'X1';
    return 'X0';
  }

  // ============================================================
  // TAREA 1-D: Pipeline SOP
  // ============================================================

  // --- expandXOR ---
  function _expandXOR(t) {
    if (!t) return t;
    if (t.kind === 'xor') {
      var A = _expandXOR(t.left), B = _expandXOR(t.right);
      return { kind: 'or', children: [
        { kind: 'and', children: [A, { kind: 'not', child: B }] },
        { kind: 'and', children: [{ kind: 'not', child: A }, B] }
      ]};
    }
    if (t.kind === 'not') return { kind: 'not', child: _expandXOR(t.child) };
    if (t.kind === 'and') return { kind: 'and', children: t.children.map(_expandXOR) };
    if (t.kind === 'or')  return { kind: 'or',  children: t.children.map(_expandXOR) };
    return t;
  }

  // --- pushDownNOT (De Morgan) ---
  function _pushDownNOT(t) {
    if (!t) return t;
    if (t.kind === 'not') {
      var c = _pushDownNOT(t.child);
      if (c.kind === 'not')  return c.child;
      if (c.kind === 'and')  return { kind: 'or',  children: c.children.map(function(x){ return _pushDownNOT({ kind:'not', child:x }); }) };
      if (c.kind === 'or')   return { kind: 'and', children: c.children.map(function(x){ return _pushDownNOT({ kind:'not', child:x }); }) };
      return { kind: 'not', child: c };
    }
    if (t.kind === 'and') return { kind: 'and', children: t.children.map(_pushDownNOT) };
    if (t.kind === 'or')  return { kind: 'or',  children: t.children.map(_pushDownNOT) };
    return t;
  }

  // --- estimateSopSize ---
  function _estimateSOP(t) {
    if (!t) return 1;
    if (t.kind === 'and') return t.children.reduce(function(a,c){ return a * _estimateSOP(c); }, 1);
    if (t.kind === 'or')  return t.children.reduce(function(a,c){ return a + _estimateSOP(c); }, 0);
    return 1;
  }

  // --- distributeAND (SOP) con límite MAX_SOP_TERMS ---
  function _distributeAND(t, state) {
    if (!t || state.overflowed) return t;
    if (t.kind === 'or')  return { kind: 'or',  children: t.children.map(function(c){ return _distributeAND(c, state); }) };
    if (t.kind !== 'and') return t;

    // Procesar hijos recursivamente
    var processed = t.children.map(function(c){ return _distributeAND(c, state); });
    if (state.overflowed) return { kind: 'and', children: processed };

    var orKids  = processed.filter(function(c){ return c.kind === 'or'; });
    var flatKids = processed.filter(function(c){ return c.kind !== 'or'; });

    if (orKids.length === 0) return { kind: 'and', children: processed };

    // Estimar antes de expandir
    if (_estimateSOP({ kind: 'and', children: processed }) > MAX_SOP_TERMS) {
      state.overflowed = true;
      return { kind: 'and', children: processed };
    }

    // Producto cartesiano PRESERVANDO el orden de los hijos: en Ladder la posición
    // de un bloque (TON, CTU...) dentro del camino importa (lo que está antes lo
    // habilita, lo que está después se combina con su salida Q).
    var result = processed.reduce(function(acc, child) {
      var alts = child.kind === 'or' ? child.children : [child];
      var expanded = [];
      acc.forEach(function(accKids) {
        alts.forEach(function(alt) {
          var bKids = alt.kind === 'and' ? alt.children : [alt];
          expanded.push(accKids.concat(bKids));
        });
      });
      return expanded;
    }, [[]]).map(function(kids) {
      return kids.length === 1 ? kids[0] : { kind: 'and', children: kids };
    });

    return result.length === 1 ? result[0] : { kind: 'or', children: result };
  }

  // --- flattenSOP ---
  function _hashTree(t) {
    if (!t) return '?';
    if (t.kind === 'contact') return 'C:' + t.addr + ':' + (t.negated ? '1' : '0');
    if (t.kind === 'edge')    return 'E:' + t.edgeType + ':' + t.addr;
    if (t.kind === 'not')     return 'NOT(' + _hashTree(t.child) + ')';
    if (t.kind === 'block')   return 'BLK:' + t.blockType + ':' + t.addr;
    if (t.kind === 'cmp')     return 'CMP:' + t.src + t.op + (t.src2 || t.value);
    if (t.kind === 'and')     return 'AND(' + t.children.map(_hashTree).sort().join(',') + ')';
    if (t.kind === 'or')      return 'OR('  + t.children.map(_hashTree).sort().join(',') + ')';
    return t.kind + ':?';
  }

  function _dedupeByHash(items) {
    var seen = {}, out = [];
    items.forEach(function(x){ var h = _hashTree(x); if (!seen[h]) { seen[h] = true; out.push(x); } });
    return out;
  }

  function _flattenSOP(t) {
    if (!t) return t;
    if (t.kind === 'or') {
      var flat = [];
      t.children.map(_flattenSOP).forEach(function(c){ if (c.kind === 'or') c.children.forEach(function(x){ flat.push(x); }); else flat.push(c); });
      flat = _dedupeByHash(flat);
      return flat.length === 1 ? flat[0] : { kind: 'or', children: flat };
    }
    if (t.kind === 'and') {
      var fand = [];
      t.children.map(_flattenSOP).forEach(function(c){ if (c.kind === 'and') c.children.forEach(function(x){ fand.push(x); }); else fand.push(c); });
      fand = _dedupeByHash(fand);
      return fand.length === 1 ? fand[0] : { kind: 'and', children: fand };
    }
    if (t.kind === 'not') return { kind: 'not', child: _flattenSOP(t.child) };
    return t;
  }

  // ============================================================
  // TAREA 1-E: ExprTree -> elementos Ladder (paths)
  // ============================================================

  var _CMP_NEG = { '>': '<=', '<': '>=', '>=': '<', '<=': '>', '==': '!=', '!=': '==' };

  function _treeToElem(t) {
    if (!t) return null;
    var neg = false;
    if (t.kind === 'not') { neg = true; t = t.child; if (!t) return null; }
    switch (t.kind) {
      case 'contact':
        return { type: 'CONTACT', var: t.addr, negated: neg !== !!t.negated };
      case 'cmp': {
        var e = { type: 'CMP', src: t.src, op: neg ? _CMP_NEG[t.op] : t.op, value: t.value | 0 };
        if (t.src2) { e.src2 = t.src2; e.value = 0; }
        return e;
      }
      case 'edge':
        return { type: 'EDGE', var: t.addr, edge: t.edgeType === 'F_TRIG' ? 'N' : 'P', negated: neg };
      default:
        return null;
    }
  }

  function _sopTermToPath(term) {
    if (!term) return [];
    var kids = term.kind === 'and' ? term.children : [term];
    var elems = [];
    kids.forEach(function (c) {
      var e = _treeToElem(c);
      if (!e) throw new Error('unrepresentable subexpression (' + (c && c.kind) + ')');
      elems.push(e);
    });
    return elems;
  }

  function _extractSopTerms(tree) {
    if (!tree) return [];
    if (tree.kind === 'or') return tree.children;
    return [tree];
  }

  // ============================================================
  // TAREA 1-F: Topológico (fallback si ir.order falta)
  // ============================================================

  function _computeOrder(nodes) {
    var n    = nodes.length;
    var indeg = new Array(n).fill(0);
    var adj  = nodes.map(function(){ return []; });
    nodes.forEach(function(nd, j) {
      [nd.in1, nd.in2].forEach(function(src) {
        if (src !== null && src !== undefined && src >= 0 && src < n) { adj[src].push(j); indeg[j]++; }
      });
    });
    var q = [], res = [];
    indeg.forEach(function(d, i){ if (d === 0) q.push(i); });
    while (q.length) { var cur = q.shift(); res.push(cur); adj[cur].forEach(function(nx){ if (--indeg[nx] === 0) q.push(nx); }); }
    for (var i = 0; i < n; i++) if (res.indexOf(i) < 0) res.push(i);
    return res;
  }

  // ============================================================
  // TAREA 1-G: convertIRToLadder — IR -> rungs (equivalencia exacta)
  // ============================================================
  //
  // Principios (v2):
  //  • Cada nodo con ESTADO (TON/TOF/TP/BLINK/CTU/CTD/SR/RS/flancos) se emite UNA
  //    sola vez, como un renglón propio, y todos sus usos son contactos sobre su
  //    variable (T0, C0, M3...). Nunca se duplica un bloque.
  //  • Q negada o compartida: contacto [T0] / [/T0], sin marcas ni retardo.
  //  • Un flanco se muestra inline [P X0] sólo si tiene un único consumidor y es
  //    la raíz de la condición; en los demás casos se guarda en una marca M
  //    (rs con S=c, R=NOT c: sigue a c en el MISMO scan, sin retardo).
  //  • CTU reset / CTD carga = bobinas RESET / LOAD sobre la variable C.
  //  • AI1/SCALE/PWM = renglones numéricos (kind:'NUM').
  //  • Si algo no puede representarse se informa (reasons[]) y NO se emite nada.
  //  • Con opts.compile (+ opts.check) el resultado se recompila y se compara
  //    con el IR original scan a scan: si difiere, no se acepta la conversión.

  function Overflow() { this.overflow = true; }
  var AREA_LIMIT = { X: 2, Y: 4, M: 64, T: 32, C: 32 };

  function _prepNodes(ir) {
    return ir.program.nodes.map(function (nd) {
      var c = {}; Object.keys(nd).forEach(function (k) { c[k] = nd[k]; });
      return c;
    });
  }

  function _convertOnce(ir, netlist) {
    var nodes = _prepNodes(ir);
    var n = nodes.length;
    var order = (ir.order && ir.order.length > 0) ? ir.order : _computeOrder(nodes);
    var reasons = [], infos = [];
    var rungs = [], rungCount = 0;
    var marks = [];

    function isIdx(k) { return k !== null && k !== undefined && k >= 0 && k < n; }
    var consumers = new Array(n).fill(0);
    nodes.forEach(function (nd) { [nd.in1, nd.in2].forEach(function (k) { if (isIdx(k)) consumers[k]++; }); });

    // ---------- direcciones ----------
    var used = { M: {}, T: {}, C: {} };
    var addrOf = {};
    function wantsVar(t) { return t === 'sr' || t === 'rs' || t === 'ton' || t === 'tof' || t === 'tp' || t === 'blink' || t === 'ctu' || t === 'ctd'; }
    function areaOf(t) { return (t === 'sr' || t === 'rs') ? 'M' : (t === 'ctu' || t === 'ctd') ? 'C' : 'T'; }
    nodes.forEach(function (nd, i) {
      if (!wantsVar(nd.type)) return;
      var ar = areaOf(nd.type), a = nd.address;
      if (a && a.area === ar && a.index >= 0 && a.index < AREA_LIMIT[ar] && !used[ar][a.index]) {
        used[ar][a.index] = true; addrOf[i] = ar + a.index;
      }
    });
    function alloc(ar) {
      for (var k = 0; k < AREA_LIMIT[ar]; k++) if (!used[ar][k]) { used[ar][k] = true; return ar + k; }
      reasons.push('Not enough ' + ar + ' addresses (limit ' + AREA_LIMIT[ar] + ')');
      return ar + '0';
    }
    nodes.forEach(function (nd, i) { if (wantsVar(nd.type) && !addrOf[i]) addrOf[i] = alloc(areaOf(nd.type)); });

    function ioAddr(nd) {
      switch (nd.type) {
        case 'input1': return 'X0';  case 'input2': return 'X1';
        case 'output1': return 'Y0'; case 'output2': return 'Y1';
        case 'output3': return 'Y2'; case 'output4': return 'Y3';
      }
      return null;
    }

    // ---------- numéricas ----------
    var numName = {}, scaleCount = 0;
    nodes.forEach(function (nd, i) {
      if (nd.type === 'analog1') numName[i] = 'AI1';
      else if (nd.type === 'scale') numName[i] = 'S' + (scaleCount++);
    });

    function pushRung(what, comment, paths, outputs) {
      rungs.push({ id: 'dc_' + (rungCount++), comment: comment || ('Decompiled from ' + what),
                   paths: paths, outputs: outputs });
    }

    // ---------- expresiones ----------
    var markOfNode = {};

    function varOfNode(i) {            // variable que se puede LEER como contacto
      var nd = nodes[i], io = ioAddr(nd);
      if (io) return io;
      if (wantsVar(nd.type)) return addrOf[i];
      if (nd.type === 'r_trig' || nd.type === 'f_trig') return ensureEdgeMark(i);
      return null;
    }

    function newMark(what) {
      var m = alloc('M'); marks.push(m); return m;
    }

    function ensureEdgeMark(i) {
      if (markOfNode[i]) return markOfNode[i];
      var nd = nodes[i];
      var sv = sourceVar(nd.in1);
      var m = newMark();
      markOfNode[i] = m;
      pushRung(nd.type, 'Flanco ' + (nd.type === 'r_trig' ? 'ascendente' : 'descendente') + ' de ' + sv + ' guardado en ' + m,
        [[{ type: 'EDGE', var: sv, edge: nd.type === 'r_trig' ? 'P' : 'N', negated: false }]],
        [{ type: 'COIL', var: m, mode: 'NORMAL' }]);
      return m;
    }

    // variable que contiene el valor del nodo i (si no la tiene, se materializa en una marca)
    function sourceVar(i) {
      if (!isIdx(i)) { reasons.push('missing source'); return 'X0'; }
      var v = varOfNode(i);
      if (v) return v;
      return ensureExprMark(i);
    }

    function ensureExprMark(i) {
      if (markOfNode[i]) return markOfNode[i];
      var m = newMark();
      markOfNode[i] = m;
      var paths = condToPaths(i, true);
      if (!paths) { reasons.push('Node ' + nodes[i].id + ': empty expression'); return m; }
      pushRung(nodes[i].type, 'Marca auxiliar ' + m + ' (sub-expresión del nodo ' + nodes[i].id + ')',
        paths, [{ type: 'COIL', var: m, mode: 'NORMAL' }]);
      return m;
    }

    function build(i, root) {
      var nd = nodes[i];
      if (!nd) { reasons.push('dangling input'); return { kind: 'contact', addr: 'X0', negated: false }; }
      var v = ioAddr(nd);
      if (v) return { kind: 'contact', addr: v, negated: false };
      if (wantsVar(nd.type)) return { kind: 'contact', addr: addrOf[i], negated: false };
      switch (nd.type) {
        case 'r_trig': case 'f_trig':
          if (root && consumers[i] === 1)
            return { kind: 'edge', edgeType: nd.type === 'r_trig' ? 'R_TRIG' : 'F_TRIG', addr: sourceVar(nd.in1) };
          return { kind: 'contact', addr: ensureEdgeMark(i), negated: false };
        case 'cmp': {
          var sa = nodes[nd.in1], t = { kind: 'cmp', src: numName[nd.in1], op: nd.op || '>', value: nd.value | 0 };
          if (isIdx(nd.in2)) t.src2 = numName[nd.in2];
          if (!sa || !t.src) reasons.push('Node ' + nd.id + ' (cmp): numeric source missing');
          return t;
        }
        case 'not': case 'and': case 'or': case 'xor': {
          if (netlist && !root) return { kind: 'contact', addr: ensureExprMark(i), negated: false };
          var a = isIdx(nd.in1) ? build(nd.in1, false) : null;
          var b = isIdx(nd.in2) ? build(nd.in2, false) : null;
          if (nd.type === 'not') return a ? { kind: 'not', child: a } : (reasons.push('NOT sin entrada'), { kind: 'contact', addr: 'X0', negated: false });
          if (nd.type === 'and') {
            if (!a || !b) { reasons.push('AND sin entrada'); return a || b; }
            return { kind: 'and', children: [a, b] };
          }
          if (nd.type === 'or') return (a && b) ? { kind: 'or', children: [a, b] } : (a || b);
          return (a && b) ? { kind: 'xor', left: a, right: b } : (a || b);
        }
      }
      reasons.push('Node ' + nd.id + ' (' + nd.type + '): cannot be read as a boolean condition');
      return { kind: 'contact', addr: 'X0', negated: false };
    }

    function condToPaths(srcIdx, forMark) {
      if (!isIdx(srcIdx)) return null;
      // en modo marca-de-expresión el nodo raíz se expande (no se vuelve a marcar)
      var saveNet = netlist;
      var tree = build(srcIdx, true);
      var t1 = _expandXOR(tree), t2 = _pushDownNOT(t1);
      var ds = { overflowed: false };
      var t3 = _distributeAND(t2, ds);
      if (ds.overflowed) throw new Overflow();
      var t4 = _flattenSOP(t3);
      var paths = [];
      _extractSopTerms(t4).forEach(function (term) {
        var p = _sopTermToPath(term);
        if (p.length) paths.push(p);
      });
      return paths.length ? paths : null;
    }

    // ---------- emisión en orden de ejecución ----------
    function blockElem(i) {
      var nd = nodes[i];
      return { type: 'BLOCK', blockType: BLOCK_IR_TYPES[nd.type], id: addrOf[i],
               preset: (nd.type === 'ctu' || nd.type === 'ctd') ? (nd.value | 0) : (nd.preset | 0) };
    }

    // Primero: sólo marcas y numéricas que otros necesiten se emiten bajo demanda;
    // el resto se recorre en orden de ejecución.
    var seenScale = {};
    order.forEach(function (i) {
      var nd = nodes[i];
      if (!nd) return;
      var t = nd.type;

      if (t === 'scale') {
        var chain = [], src = numName[nd.in1];
        if (src === 'AI1') chain.push({ fn: 'AI1' });
        chain.push({ fn: 'SCALE', id: numName[i], src: src,
          inMin: nd.scaleInMin !== undefined ? nd.scaleInMin : nd.inMin,
          inMax: nd.scaleInMax !== undefined ? nd.scaleInMax : nd.inMax,
          outMin: nd.scaleOutMin !== undefined ? nd.scaleOutMin : nd.outMin,
          outMax: nd.scaleOutMax !== undefined ? nd.scaleOutMax : nd.outMax });
        rungs.push({ id: 'dc_' + (rungCount++), kind: 'NUM', comment: 'SCALE ' + numName[i], paths: [], outputs: [], chain: chain });
        return;
      }

      if (t === 'pwm') {
        var o = nd.outIdx | 0;
        if (isIdx(nd.in1) && (nodes[nd.in1].type === 'analog1' || nodes[nd.in1].type === 'scale')) {
          rungs.push({ id: 'dc_' + (rungCount++), kind: 'NUM', comment: 'PWM' + (o + 1), paths: [], outputs: [],
                       chain: [{ fn: 'PWM', out: o, src: numName[nd.in1] }] });
        } else if (isIdx(nd.in1)) {
          var pp = condToPaths(nd.in1);
          if (pp) pushRung('pwm', 'PWM' + (o + 1) + ' on/off', pp, [{ type: 'PWM', out: o }]);
        }
        return;
      }

      if (BLOCK_IR_TYPES[t]) {
        var be = blockElem(i), paths;
        if (isIdx(nd.in1)) {
          paths = condToPaths(nd.in1);
          if (!paths) { reasons.push('Node ' + nd.id + ' (' + t + '): empty enable'); return; }
          paths = paths.map(function (p) { return p.concat([JSON.parse(JSON.stringify(be))]); });
        } else paths = [[be]];
        pushRung(t, t.toUpperCase() + ' ' + addrOf[i] + (t === 'blink' ? ' (período en ms)' : ''), paths, []);
        if ((t === 'ctu' || t === 'ctd') && isIdx(nd.in2)) {
          var rp = condToPaths(nd.in2);
          if (rp) pushRung(t, (t === 'ctu' ? 'RESET ' : 'LOAD ') + addrOf[i], rp,
            [{ type: 'COIL', var: addrOf[i], mode: t === 'ctu' ? 'RESET' : 'LOAD' }]);
        }
        return;
      }

      if (t === 'r_trig' || t === 'f_trig') {
        // Si nadie lo lee como variable ni inline, no se emite nada
        return;
      }

      if (t === 'sr' || t === 'rs') {
        var s = nd.in1, r = nd.in2, hasS = isIdx(s), hasR = isIdx(r), mv = addrOf[i];
        if (t === 'rs' && hasS && hasR && nodes[r].type === 'not' && nodes[r].in1 === s) {
          var pn = condToPaths(s);
          if (pn) pushRung('rs', 'Bobina ' + mv, pn, [{ type: 'COIL', var: mv, mode: 'NORMAL' }]);
          return;
        }
        var dom = (t === 'rs') ? { dom: 'R' } : {};
        if (hasS) { var sp = condToPaths(s); if (sp) pushRung(t, 'SET ' + mv, sp, [Object.assign({ type: 'COIL', var: mv, mode: 'SET' }, dom)]); }
        if (hasR) { var rr = condToPaths(r); if (rr) pushRung(t, 'RESET ' + mv, rr, [Object.assign({ type: 'COIL', var: mv, mode: 'RESET' }, dom)]); }
        return;
      }

      var yv = ioAddr(nd);
      if (yv && /^Y/.test(yv)) {
        var yp = condToPaths(nd.in1);
        if (yp) pushRung(t, 'Salida ' + yv, yp, [{ type: 'COIL', var: yv, mode: 'NORMAL' }]);
      }
    });

    // Edges/expresiones pedidas en orden de ejecución pueden haber quedado detrás:
    // el orden de los renglones no altera el resultado (el compilador resuelve el orden).
    if (marks.length) infos.push('Se usaron ' + marks.length + ' marca(s) M auxiliar(es): ' + marks.join(', ') +
      ' (siguen a su condición en el mismo scan: sin retardo).');
    return { rungs: rungs, reasons: reasons, infos: infos, marks: marks };
  }

  function convertIRToLadder(ir, opts) {
    opts = opts || {};
    var analysis = analyzeIR(ir);
    var res = { ok: false, rungs: null, analysis: analysis, reasons: [], warnings: [], verified: false, marks: [] };
    if (!analysis.convertible) {
      res.reasons = analysis.warnings.slice();
      return res;
    }
    var firstFail = null;
    var modes = [false, true];            // 1) forma legible  2) una marca por compuerta
    for (var mi = 0; mi < modes.length; mi++) {
      var out;
      try { out = _convertOnce(ir, modes[mi]); }
      catch (e) {
        if (e instanceof Overflow) {
          if (mi === 0) continue;         // expresión enorme: pasa al modo 2
          firstFail = firstFail || ['Expression too large even when split into auxiliary marks'];
          continue;
        }
        res.reasons = ['Conversion failed: ' + (e && e.message ? e.message : String(e))];
        return res;
      }
      if (out.reasons.length) { res.reasons = out.reasons; return res; }
      if (!out.rungs.length) { res.reasons = ['No rungs generated from IR']; return res; }

      var warnings = out.infos.slice();
      if (modes[mi]) warnings.push('Expresiones muy grandes o lazo sensible al orden: se descompusieron en marcas auxiliares (una por compuerta).');

      if (typeof opts.compile === 'function' && opts.check) {
        var ir2, eq;
        try { ir2 = opts.compile({ rungs: out.rungs }); }
        catch (e) { firstFail = firstFail || ['Recompilation of the generated Ladder failed: ' + e.message]; continue; }
        var sigA = _loopSignature(ir.program.nodes), sigB = _loopSignature(ir2.program.nodes);
        if (sigA.length && (sigA.join('|') !== sigB.join('|') || sigA.indexOf('INVALID') >= 0)) {
          firstFail = firstFail || ['Structural validation failed: the regenerated Ladder does not keep each feedback loop with exactly the same single memory block (FBD: ' +
            sigA.join(', ') + '; Ladder: ' + (sigB.join(', ') || 'no loop') + '), or it introduced auxiliary marks/edge blocks inside the loop. The conversion was rejected and the original program was kept.'];
          continue;
        }
        try { eq = opts.check.equivalent(ir, ir2, opts.checkOpts); }
        catch (e) { firstFail = firstFail || ['Equivalence check could not run: ' + e.message]; continue; }
        if (!eq.ok) {
          firstFail = firstFail || ['The generated Ladder is NOT equivalent to the FBD program (' + JSON.stringify(eq.diff) +
            '). If the program feeds a signal back into its own condition (e.g. an output holding itself), its evaluation order inside the loop ' +
            'cannot be reproduced exactly; use an SR/RS latch instead. The conversion was rejected and the original program was kept.'];
          continue;
        }
        res.verified = true; res.verifiedSteps = eq.steps;
      } else {
        if (_analyzeLoops(ir.program.nodes).length) { firstFail = firstFail || ['A feedback loop can only be converted with structural validation (compile/check not supplied).']; continue; }
        warnings.push('Equivalence not verified (no compiler/check supplied).');
      }
      res.ok = true; res.rungs = out.rungs; res.marks = out.marks; res.warnings = warnings;
      return res;
    }
    res.reasons = firstFail || ['Conversion failed'];
    return res;
  }

  /* Compatibilidad: rungs o null */
  function irToLadderAST(ir, opts) {
    var r = convertIRToLadder(ir, opts);
    return r.ok ? r.rungs : null;
  }

  function _inferAddr(nd, nodeIdx) { return nd.address || { area: 'M', index: nodeIdx }; }

  // ============================================================
  // TAREA 1-H: decompileIRToLadder — punto de entrada principal
  // ============================================================

  /**
   * decompileIRToLadder(ir, opts) → { rungs, analysis, warnings, verified, marks } | null
   * Para conocer el motivo del rechazo usar convertIRToLadder(ir, opts).reasons.
   */
  function decompileIRToLadder(ir, opts) {
    var r = convertIRToLadder(ir, opts);
    if (!r.ok) {
      console.warn('[LadderDecompiler] IR not converted:', r.reasons);
      return null;
    }
    return { rungs: r.rungs, analysis: r.analysis, warnings: r.warnings, verified: r.verified, marks: r.marks };
  }

  // ============================================================
  // MINI EVALUADOR BOOLEANO (para tests de equivalencia)
  // ============================================================

  /**
   * evalIR(ir, inputs) → { 'Y0': bool, ... }
   * inputs: { 'X0': true, 'X1': false, ... }
   * Evalúa solo nodos combinacionales (AND/OR/NOT/input/output).
   * Múltiples outputs con la misma dirección → OR lógico.
   */
  function evalIR(ir, inputs) {
    var nodes = ir.program.nodes;
    var order = (ir.order && ir.order.length > 0) ? ir.order : _computeOrder(nodes);
    var state = new Array(nodes.length).fill(false);

    order.forEach(function(i) {
      var nd = nodes[i];
      if (!nd) return;
      var v1 = (nd.in1 !== null && nd.in1 >= 0) ? state[nd.in1] : false;
      var v2 = (nd.in2 !== null && nd.in2 >= 0) ? state[nd.in2] : false;
      switch (nd.type) {
        case 'input1': case 'input2':
          state[i] = inputs[_addrStr(nd)] === true; break;
        case 'not':   state[i] = !v1; break;
        case 'and':   state[i] = v1 && v2; break;
        case 'or':    state[i] = v1 || v2; break;
        case 'xor':   state[i] = v1 !== v2; break;
        case 'output1': case 'output2': case 'output3': case 'output4':
          state[i] = v1; break;
        default: state[i] = false;
      }
    });

    var out = {};
    nodes.forEach(function(nd, i) {
      if (/^output[1-4]$/.test(nd.type) && nd.address) {
        var k = nd.address.area + nd.address.index;
        out[k] = (out[k] || false) || state[i]; // OR lógico si hay múltiples rungs
      }
    });
    return out;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    // API principal
    analyzeIR:           analyzeIR,
    analyzeLoops:        function (ir) { return _analyzeLoops(ir.program.nodes); },
    irToLadderAST:       irToLadderAST,
    convertIRToLadder:   convertIRToLadder,
    decompileIRToLadder: decompileIRToLadder,

    // Sub-funciones del pipeline (debugging/testing)
    detectEdgePatterns:  _detectEdgePatterns,
    expandXOR:           _expandXOR,
    pushDownNOT:         _pushDownNOT,
    distributeAND:       function(t){ var s={overflowed:false}; return _distributeAND(t,s); },
    flattenSOP:          _flattenSOP,
    evalIR:              evalIR,

    // Constantes
    MAX_SOP_TERMS: MAX_SOP_TERMS,
    NODE_LEVEL:    NODE_LEVEL
  };

}));
