/* ============================================================
   PLC-CORE-MDE — Ladder AST Layer v1
   ============================================================
   PURPOSE:
     Introduce a structured intermediate representation (AST)
     between the Ladder UI data and the IR emitted to the PLC.

   FLOW:
     UI (paths format) → legacyToPaths() → rungToAST() → IR

   THIS FILE IS ADDITIVE — it does NOT replace compiler.js.
   The existing compileLadder() function is preserved and still
   works for any code that calls it directly.

   PUBLIC API (exposed as window.LadderAST):
     LadderAST.legacyToPaths(rung)  — migrate old cell format
     LadderAST.rungToAST(rung)      — convert new paths format → AST node
     LadderAST.validateRung(rung)   — returns [] on ok, [string,...] on errors
     LadderAST.astToIR(ast, nodeId) — emit IR nodes from AST
   ============================================================ */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LadderAST = factory();
}(typeof self !== 'undefined' ? self : this, function() {

  /* ----------------------------------------------------------
     1. TYPES
     ----------------------------------------------------------
     Contact:
       { type: "CONTACT", var: "X0", negated: false }
       { type: "CONTACT", var: "X1", negated: true }   // NC
     Coil:
       { type: "COIL", var: "Y0", mode: "NORMAL" }
       { type: "COIL", var: "M0", mode: "SET"    }
       { type: "COIL", var: "M0", mode: "RESET"  }
     Block (future):
       { type: "BLOCK", blockType: "TON", id: "T0" }
  ---------------------------------------------------------- */

  /* ----------------------------------------------------------
     2. legacyToPaths(rung)
     ----------------------------------------------------------
     Adapts the OLD rung format used by the original ladder.html
     (rows of cell objects) into the NEW structured paths format.

     OLD FORMAT:
       rung.rows = [ [cell, cell, ...], ... ]
       cell = { type: "NO"|"NC"|"COIL", addr: "X0" }

     NEW FORMAT:
       rung.paths   = [ [ element, ... ], ... ]   // series paths (OR'd)
       rung.outputs = [ coil, ... ]               // coil elements
  ---------------------------------------------------------- */
  function legacyToPaths(rung) {
    // Already in new format — return as-is
    if (rung.paths !== undefined) return rung;

    var rows = rung.rows || rung.cells || [];
    var paths  = [];
    var outputs = [];

    rows.forEach(function(row) {
      if (!Array.isArray(row)) return;
      var pathElements = [];

      row.forEach(function(cell) {
        if (!cell || !cell.type) return;

        if (cell.type === 'COIL') {
          // Collect coils separately
          var coilMode = 'NORMAL';
          if (cell.mode === 'SET')   coilMode = 'SET';
          if (cell.mode === 'RESET') coilMode = 'RESET';
          // Only add once (deduplicate by addr+mode)
          var alreadyAdded = outputs.some(function(c) {
            return c.var === (cell.addr || cell.var) && c.mode === coilMode;
          });
          if (!alreadyAdded) {
            outputs.push({ type: 'COIL', var: (cell.addr || cell.var || ''), mode: coilMode });
          }
          return;
        }

        if (cell.type === 'NO' || cell.type === 'NC' || cell.type === 'CONTACT') {
          pathElements.push({
            type: 'CONTACT',
            var:  cell.addr || cell.var || '',
            negated: (cell.type === 'NC' || cell.negated === true)
          });
          return;
        }

        if (cell.type === 'BLOCK' || cell.blockType) {
          pathElements.push({
            type: 'BLOCK',
            blockType: cell.blockType || cell.type,
            id: cell.id || cell.addr || ''
          });
          return;
        }
      });

      if (pathElements.length > 0) {
        paths.push(pathElements);
      }
    });

    // If there was a top-level outputs field (new format mixed in)
    if (Array.isArray(rung.outputs)) {
      rung.outputs.forEach(function(o) {
        var dup = outputs.some(function(c){ return c.var===o.var && c.mode===o.mode; });
        if (!dup) outputs.push(o);
      });
    }

    return { paths: paths, outputs: outputs };
  }

  /* ----------------------------------------------------------
     3. rungToAST(rung)
     ----------------------------------------------------------
     Converts a rung in NEW paths format into an AST expression
     node.

     LOGIC RULES:
       • Each path[]  → AND chain   (series contacts)
       • paths[]      → OR of all paths (parallel branches)
       • CONTACT      → VAR node (negated = NOT wrapper)
       • BLOCK        → VAR referencing block output register
       • Outputs remain as separate coil descriptors

     RETURNED AST NODE FORMAT:
       {
         expr: <ast-expression>,   // combinational logic tree
         outputs: [coil, ...]      // output descriptors
       }

     EXPRESSION NODE TYPES:
       { op: "VAR",  var: "X0" }
       { op: "NOT",  arg: <expr> }
       { op: "AND",  left: <expr>, right: <expr> }
       { op: "OR",   left: <expr>, right: <expr> }
       { op: "TRUE" }              // constant 1 (empty path)
  ---------------------------------------------------------- */
  function rungToAST(rung) {
    if (rung && rung.kind === 'NUM') {
      return { expr: { op: 'NUM', chain: rung.chain || [] }, outputs: [] };
    }
    // Normalise to paths format first
    var normalised = legacyToPaths(rung);
    var paths   = normalised.paths   || [];
    var outputs = normalised.outputs || [];

    if (paths.length === 0) {
      // No logic — always-false rung (outputs won't be driven)
      return { expr: { op: 'FALSE' }, outputs: outputs };
    }

    // Build AND-chain for each path
    var pathExprs = paths.map(function(path) {
      return _buildANDChain(path);
    });

    // OR all path expressions together
    var expr = pathExprs.reduce(function(acc, cur) {
      if (!acc) return cur;
      return { op: 'OR', left: acc, right: cur };
    }, null);

    return { expr: expr || { op: 'FALSE' }, outputs: outputs };
  }

  /* Build an AND-chain from a flat array of elements */
  function _buildANDChain(elements) {
    if (!elements || elements.length === 0) return { op: 'TRUE' };

    var terms = elements.map(function(elem) {
      return _elementToExpr(elem);
    });

    return terms.reduce(function(acc, cur) {
      if (!acc) return cur;
      return { op: 'AND', left: acc, right: cur };
    }, null) || { op: 'TRUE' };
  }

  /* Convert a single element into an AST expression leaf */
  function _elementToExpr(elem) {
    if (!elem) return { op: 'TRUE' };

    if (elem.type === 'CONTACT') {
      var base = { op: 'VAR', var: elem.var || '' };
      return elem.negated ? { op: 'NOT', arg: base } : base;
    }

    if (elem.type === 'BLOCK') {
      // Block output is read from its id register (e.g. T0 done bit)
      return { op: 'VAR', var: elem.id || '' };
    }

    if (elem.type === 'EDGE') {
      var e = { op: 'EDGE', edge: elem.edge === 'N' ? 'N' : 'P', var: elem.var || '' };
      return elem.negated ? { op: 'NOT', arg: e } : e;
    }

    if (elem.type === 'CMP') {
      var c = { op: 'CMP', src: elem.src || '', cmpOp: elem.op || '>' };
      if (elem.src2) c.src2 = elem.src2; else c.value = elem.value | 0;
      return elem.negated ? { op: 'NOT', arg: c } : c;
    }

    // Fallback — treat unknown as a VAR
    return { op: 'VAR', var: (elem.var || elem.id || '') };
  }

  /* ----------------------------------------------------------
     4. validateRung(rung)
     ----------------------------------------------------------
     Returns an empty array if the rung is valid.
     Returns an array of error strings describing problems.
  ---------------------------------------------------------- */
  var ADDR_RE   = /^[XYMTC]\d+$/;
  var NUM_RE    = /^(AI1|A0|S\d+)$/;
  var CMP_OPS   = ['>', '<', '>=', '<=', '==', '!='];
  var BLOCK_AREA = { TON: 'T', TOF: 'T', TP: 'T', BLINK: 'T', CTU: 'C', CTD: 'C' };
  var FORMAT_VERSION = 4;

  function _isInt(v) { return typeof v === 'number' ? isFinite(v) && Math.floor(v) === v : /^-?\d+$/.test(String(v)); }

  function _validateNumRung(rung) {
    var errors = [];
    var chain = rung.chain || [];
    if (!chain.length) return ['Analog rung is empty. Add AI1, SCALE or PWM blocks.'];
    var prev = null, seen = {};
    chain.forEach(function (b, i) {
      var loc = 'Analog block ' + (i + 1);
      var fn = String((b && b.fn) || '').toUpperCase();
      if (fn === 'AI1') { prev = 'AI1'; return; }
      if (fn === 'SCALE') {
        if (!b.id || !/^S\d+$/.test(b.id)) errors.push(loc + ': SCALE needs an id like S0, S1.');
        else if (seen[b.id]) errors.push(loc + ': SCALE id ' + b.id + ' repeated in this rung.');
        else seen[b.id] = true;
        var src = b.src || prev;
        if (!src) errors.push(loc + ': SCALE has no input (put AI1 before it or set its source).');
        else if (!NUM_RE.test(src)) errors.push(loc + ': SCALE source "' + src + '" is not AI1 or Sn.');
        ['inMin', 'inMax', 'outMin', 'outMax'].forEach(function (k) {
          if (b[k] !== undefined && !_isInt(b[k])) errors.push(loc + ': ' + k + ' must be an integer.');
        });
        prev = b.id || prev;
        return;
      }
      if (fn === 'PWM') {
        var ps = b.src || prev;
        if (!ps) errors.push(loc + ': PWM has no numeric input.');
        else if (!NUM_RE.test(ps)) errors.push(loc + ': PWM source "' + ps + '" is not AI1 or Sn.');
        if (!_isInt(b.out) || b.out < 0 || b.out > 3) errors.push(loc + ': PWM output must be 1-4.');
        return;
      }
      errors.push(loc + ': unknown analog block "' + (b && b.fn) + '".');
    });
    return errors;
  }

  function validateRung(rung) {
    if (rung && rung.kind === 'NUM') return _validateNumRung(rung);
    var errors = [];
    var normalised = legacyToPaths(rung);
    var paths   = normalised.paths   || [];
    var outputs = normalised.outputs || [];

    var nonEmptyPaths = paths.filter(function(p){ return Array.isArray(p) && p.length > 0; });

    // Blank rung: no errors until the user edits something
    if (nonEmptyPaths.length === 0 && outputs.length === 0) return [];

    var hasBlock = paths.some(function (p) {
      return (p || []).some(function (e) { return e && e.type === 'BLOCK'; });
    });

    // A rung that contains a function block defines it; it needs no coil
    if (outputs.length === 0 && !hasBlock) {
      errors.push('Rung has no output coil. Add at least one coil (Y, M, etc.).');
    }
    if (nonEmptyPaths.length === 0) {
      errors.push('Rung has no logic paths. Add at least one contact.');
    }
    if (nonEmptyPaths.length > 0) {
      paths.forEach(function(path, i) {
        if (!Array.isArray(path) || path.length === 0)
          errors.push('Path ' + (i + 1) + ' is empty. Remove it or add a contact.');
      });
    }
    paths.forEach(function(path, i) {
      (path || []).forEach(function(elem, j) {
        if (elem && elem.type === 'COIL')
          errors.push('Path ' + (i+1) + ' position ' + (j+1) + ': coil found inside path. Coils must be outputs only.');
      });
    });

    function badAddr(v, loc) {
      if (!v) errors.push(loc + ': element has no variable address assigned.');
      else if (!ADDR_RE.test(String(v).toUpperCase()))
        errors.push(loc + ': address "' + v + '" is not valid. Use X0, Y1, M3, T0, C0 etc.');
    }

    paths.forEach(function(path, i) {
      (path || []).forEach(function(elem, j) {
        if (!elem) return;
        var loc = 'Path ' + (i+1) + ' pos ' + (j+1);
        switch (elem.type) {
          case 'EDGE':
            badAddr(elem.var, loc);
            if (elem.edge !== 'P' && elem.edge !== 'N') errors.push(loc + ': edge contact must be [P] or [N].');
            break;
          case 'CMP':
            if (!elem.src || !NUM_RE.test(elem.src)) errors.push(loc + ': CMP needs a numeric source (AI1 or S0, S1...).');
            if (CMP_OPS.indexOf(elem.op || '>') < 0) errors.push(loc + ': CMP operator "' + elem.op + '" is not valid.');
            if (elem.src2) { if (!NUM_RE.test(elem.src2)) errors.push(loc + ': CMP second source is not AI1 or Sn.'); }
            else if (!_isInt(elem.value === undefined ? 0 : elem.value)) errors.push(loc + ': CMP value must be an integer.');
            break;
          case 'BLOCK': {
            var id = elem.id || elem.var || '';
            var want = BLOCK_AREA[elem.blockType];
            if (!want) errors.push(loc + ': unknown block type "' + elem.blockType + '".');
            else if (!new RegExp('^' + want + '\\d+$').test(String(id).toUpperCase()))
              errors.push(loc + ': ' + elem.blockType + ' needs a ' + (want === 'T' ? 'timer (T0, T1...)' : 'counter (C0, C1...)') + ' address, not "' + id + '".');
            if (elem.preset !== undefined && (!_isInt(elem.preset) || elem.preset < 0))
              errors.push(loc + ': preset must be a non-negative integer.');
            break;
          }
          default:
            badAddr(elem.var || elem.id, loc);
        }
      });
    });

    outputs.forEach(function(coil, i) {
      var loc = 'Output ' + (i + 1);
      if (coil.type === 'PWM') {
        if (!_isInt(coil.out) || coil.out < 0 || coil.out > 3) errors.push(loc + ': PWM output must be 1-4.');
        return;
      }
      badAddr(coil.var, loc);
      var v = String(coil.var || '').toUpperCase(), mode = coil.mode || 'NORMAL';
      if (['NORMAL', 'SET', 'RESET', 'LOAD'].indexOf(mode) < 0) errors.push(loc + ': unknown coil mode "' + mode + '".');
      if (/^X/.test(v)) errors.push(loc + ': inputs (X) cannot be written by a coil.');
      if (mode === 'LOAD' && !/^C/.test(v)) errors.push(loc + ': LOAD is only valid on a counter (C).');
      if (/^C/.test(v) && mode === 'SET') errors.push(loc + ': a counter has no SET; use RESET (CTU) or LOAD (CTD).');
      if (/^T/.test(v) && (mode === 'RESET' || mode === 'LOAD')) errors.push(loc + ': ' + mode + ' is not available on timers.');
      if (coil.dom !== undefined && coil.dom !== 'R' && coil.dom !== 'S') errors.push(loc + ': unknown priority "' + coil.dom + '".');
    });

    return errors;
  }

  /* validateProgram(rungs) -> [{ rung:index, level:'error'|'warn', msg }]
     Cross-rung checks that a single rung cannot see. */
  function validateProgram(rungs) {
    var out = [];
    function add(ri, level, msg) { out.push({ rung: ri, level: level, msg: msg }); }
    var blocks = {}, scales = {}, pwmOut = {}, coilsByVar = {}, ypwm = {};
    rungs.forEach(function (r, ri) {
      if (!r) return;
      if (r.kind === 'NUM') {
        (r.chain || []).forEach(function (b) {
          var fn = String(b.fn || '').toUpperCase();
          if (fn === 'SCALE' && b.id) {
            if (scales[b.id] !== undefined && scales[b.id] !== ri) add(ri, 'error', 'SCALE ' + b.id + ' is already defined in rung ' + (scales[b.id] + 1) + '.');
            scales[b.id] = ri;
          }
          if (fn === 'PWM') {
            if (pwmOut[b.out] !== undefined) add(ri, 'warn', 'PWM' + (b.out + 1) + ' is driven more than once (rung ' + (pwmOut[b.out] + 1) + ').');
            pwmOut[b.out] = ri; ypwm['Y' + b.out] = ri;
          }
        });
        return;
      }
      var n = legacyToPaths(r);
      (n.paths || []).forEach(function (p) {
        (p || []).forEach(function (e) {
          if (e && e.type === 'BLOCK') {
            var id = String(e.id || '').toUpperCase();
            if (blocks[id] && blocks[id].type !== e.blockType)
              add(ri, 'error', 'Address ' + id + ' is used by ' + blocks[id].type + ' (rung ' + (blocks[id].rung + 1) + ') and by ' + e.blockType + '. A timer/counter address can hold only one block type.');
            else if (!blocks[id]) blocks[id] = { type: e.blockType, rung: ri, preset: e.preset };
            else if ((blocks[id].preset | 0) !== (e.preset | 0))
              add(ri, 'warn', id + ' appears in two rungs with different presets (' + blocks[id].preset + ' / ' + e.preset + '); the last one wins.');
          }
        });
      });
      (n.outputs || []).forEach(function (c) {
        if (c.type === 'PWM') {
          if (pwmOut[c.out] !== undefined) add(ri, 'warn', 'PWM' + (c.out + 1) + ' is driven more than once (rung ' + (pwmOut[c.out] + 1) + ').');
          pwmOut[c.out] = ri; ypwm['Y' + c.out] = ri;
          return;
        }
        if (c.mode === 'SET' || c.mode === 'RESET') {
          var k = String(c.var || '').toUpperCase();
          (coilsByVar[k] = coilsByVar[k] || []).push({ dom: c.dom === 'R' ? 'R' : 'S', rung: ri });
        }
      });
    });
    Object.keys(coilsByVar).forEach(function (k) {
      var doms = {}; coilsByVar[k].forEach(function (c) { doms[c.dom] = true; });
      if (doms.R && doms.S) add(coilsByVar[k][0].rung, 'error', k + ': SET/RESET coils disagree on priority (SR set-dominant vs RS reset-dominant). Use one priority for all coils of the same variable.');
    });
    rungs.forEach(function (r, ri) {
      if (!r) return;
      if (r.kind === 'NUM') return;
      var n = legacyToPaths(r);
      (n.paths || []).forEach(function (p) {
        (p || []).forEach(function (e) {
          if (!e) return;
          if (e.type === 'CMP') {
            [e.src, e.src2].forEach(function (s) {
              if (s && /^S\d+$/.test(s) && scales[s] === undefined)
                add(ri, 'error', 'CMP uses ' + s + ' but no SCALE ' + s + ' is defined (add it in an analog rung).');
            });
          }
          if (e.type === 'CONTACT' || e.type === 'EDGE') {
            var v = String(e.var || '').toUpperCase();
            if (/^[TC]\d+$/.test(v) && !blocks[v])
              add(ri, 'warn', v + ' is read as a contact but no timer/counter block ' + v + ' exists in the program (it will always be OFF).');
          }
        });
      });
      (n.outputs || []).forEach(function (c) {
        if (c.type === 'PWM') return;
        var v = String(c.var || '').toUpperCase();
        if (/^C\d+$/.test(v) && (c.mode === 'RESET' || c.mode === 'LOAD') && !blocks[v])
          add(ri, 'warn', c.mode + ' ' + v + ': no counter block ' + v + ' exists in the program.');
        if (/^Y\d$/.test(v) && ypwm[v] !== undefined)
          add(ri, 'warn', v + ' is also driven by PWM' + (parseInt(v[1], 10) + 1) + '; the PWM wins on that pin.');
      });
    });
    return out;
  }

  /* migrateRung(raw) -> rung in the current model (v4).
     v1/v2 (rows/cells), v3 (paths + BLOCK/CONTACT) and v4 all open; every
     existing field and parameter is kept, new fields only get defaults. */
  function migrateRung(raw, idGen) {
    var m = legacyToPaths(raw);
    if (m === raw) m = JSON.parse(JSON.stringify(raw));          // never mutate the caller's data
    if (!m.id && raw && raw.id) m.id = raw.id;
    if (!m.comment && raw && raw.comment) m.comment = raw.comment;
    if (!m.id) m.id = idGen ? idGen() : String(Math.random());
    if (m.comment === undefined || m.comment === null) m.comment = '';
    if (m.kind === 'NUM') {
      if (!Array.isArray(m.chain)) m.chain = [];
      m.paths = []; m.outputs = [];
      return m;
    }
    if (!Array.isArray(m.paths))   m.paths   = [[]];
    if (!Array.isArray(m.outputs)) m.outputs = [];
    m.paths = m.paths.map(function (p) {
      return (p || []).map(function (e) {
        if (!e) return e;
        if (e.type === 'BLOCK') {
          if (!e.blockType) e.blockType = /^C/i.test(e.id || '') ? 'CTU' : 'TON';
          if (e.preset === undefined) e.preset = 0;
          if (typeof e.preset === 'string') e.preset = parseInt(e.preset, 10) || 0;
        }
        return e;
      });
    });
    return m;
  }

  /* migrateProgram(data, idGen) -> { rungs, fromVersion, notes }
     Accepts every shape the editor has ever saved or exported:
       array of rungs | {rungs} | {ladder:{rungs}} | {format:'ladder-pro', version, rungs} */
  function migrateProgram(data, idGen) {
    var raw = null, ver = 1, notes = [];
    if (Array.isArray(data)) raw = data;
    else if (data && Array.isArray(data.rungs)) { raw = data.rungs; ver = data.version || 3; }
    else if (data && data.ladder && Array.isArray(data.ladder.rungs)) { raw = data.ladder.rungs; ver = data.ladder.formatVersion || 3; }
    if (!raw) return { rungs: null, fromVersion: 0, notes: ['No Ladder rungs found in the file.'] };
    if (ver > FORMAT_VERSION) notes.push('File format v' + ver + ' is newer than this editor (v' + FORMAT_VERSION + '); unknown elements may not display.');
    // Un archivo dañado no puede reemplazar el programa abierto: cada renglón debe tener una forma reconocible.
    for (var q = 0; q < raw.length; q++) {
      var rr = raw[q], why = null;
      if (!rr || typeof rr !== 'object' || Array.isArray(rr)) why = 'no es un renglón';
      else if (rr.kind === 'NUM') { if (!Array.isArray(rr.chain)) why = 'el renglón analógico no tiene cadena'; }
      else if (!(Array.isArray(rr.paths) || Array.isArray(rr.rows) || Array.isArray(rr.cells))) why = 'no tiene rutas (paths/rows/cells)';
      else if (rr.paths !== undefined && (!Array.isArray(rr.paths) || rr.paths.some(function (p) { return !Array.isArray(p); }))) why = 'las rutas no son listas de elementos';
      else if (rr.outputs !== undefined && !Array.isArray(rr.outputs)) why = 'las salidas no son una lista';
      if (why) return { rungs: null, fromVersion: 0, notes: ['The file is damaged: rung ' + (q + 1) + ' ' + why + '. The current program was kept.'] };
    }
    var rungs = raw.map(function (r) { return migrateRung(r, idGen); });
    if (ver < FORMAT_VERSION) notes.push('Project migrated from format v' + ver + ' to v' + FORMAT_VERSION + ' (no content was changed).');
    return { rungs: rungs, fromVersion: ver, notes: notes };
  }

  /* ----------------------------------------------------------
     5. astToIR(astNode, startId)
     ----------------------------------------------------------
     Walks the AST expression tree and emits IR nodes compatible
     with the existing compiler.js IR format.

     Returns: { nodes: [...], rootIdx: <index of output node>, nextId: <next free id> }

     The caller can append output (coil) nodes afterwards.
  ---------------------------------------------------------- */
  function astToIR(astNode, startId) {
    var nodes  = [];
    var nextId = startId || 1;

    function emit(nd) {
      nodes.push(nd);
      return nodes.length - 1;  // index
    }

    function makeBase(id, type) {
      return {
        id: id, type: type,
        in1: null, in2: null, outputs: [],
        preset: 0, value: 0, op: '>', outIdx: 0,
        pv: 0, inMin: 0, inMax: 4095, outMin: 0, outMax: 100,
        memIn1: null, memIn2: null, memOut: null
      };
    }

    function walk(expr) {
      if (!expr) return null;

      switch (expr.op) {
        case 'TRUE': {
          // Constant 1: use a virtual "always on" node
          // We model it as an NC contact on a non-existent address with NOT
          // In practice the runtime will read 0 from an unused M bit and NOT it = 1
          // This is safe because M255 (or similar high index) is never used.
          var nd = makeBase(nextId++, 'input1');
          nd.memIn1 = 0x02FF; // M255 — guaranteed unused sentinel
          var i = emit(nd);
          var notNd = makeBase(nextId++, 'not');
          notNd.in1 = i;
          return emit(notNd);
        }

        case 'FALSE': {
          var nd = makeBase(nextId++, 'input1');
          nd.memIn1 = 0x02FF;
          return emit(nd); // raw read of 0 = always false
        }

        case 'VAR': {
          var v   = expr.var || '';
          var typ = _varToIRType(v);
          var nd  = makeBase(nextId++, typ);
          nd.outIdx = _varToIdx(v);
          nd.memIn1 = _varToMem(v);
          return emit(nd);
        }

        case 'NOT': {
          var argIdx = walk(expr.arg);
          var nd = makeBase(nextId++, 'not');
          nd.in1 = argIdx;
          return emit(nd);
        }

        case 'AND': {
          var lIdx = walk(expr.left);
          var rIdx = walk(expr.right);
          var nd = makeBase(nextId++, 'and');
          nd.in1 = lIdx; nd.in2 = rIdx;
          return emit(nd);
        }

        case 'OR': {
          var lIdx = walk(expr.left);
          var rIdx = walk(expr.right);
          var nd = makeBase(nextId++, 'or');
          nd.in1 = lIdx; nd.in2 = rIdx;
          return emit(nd);
        }

        case 'EDGE': case 'CMP': case 'NUM':
          throw new Error('astToIR: ' + expr.op + ' is only supported by compileLadder (paths model)');

        default:
          return null;
      }
    }

    var rootIdx = walk(astNode.expr);

    // Patch output[] arrays (used by topological sort)
    nodes.forEach(function(nd, i) {
      if (nd.in1 !== null && nd.in1 >= 0) nodes[nd.in1].outputs.push(nd.id);
      if (nd.in2 !== null && nd.in2 >= 0) nodes[nd.in2].outputs.push(nd.id);
    });

    return { nodes: nodes, rootIdx: rootIdx, nextId: nextId };
  }

  /* --- Address helpers (mirrors compiler.js private fns) --- */
  function _varToIRType(v) {
    if (!v) return 'input1';
    var l = v[0].toUpperCase();
    if (l === 'X') return 'input1';
    if (l === 'Y') return 'output1';
    if (l === 'M') return 'sr';
    if (l === 'T') return 'input1';  // timer done bit read as digital input
    if (l === 'C') return 'input1';  // counter done bit
    return 'input1';
  }
  function _varToIdx(v) {
    if (!v) return 0;
    return parseInt(v.slice(1) || '0') || 0;
  }
  function _varToMem(v) {
    if (!v) return null;
    var l = v[0].toUpperCase(), n = _varToIdx(v);
    if (l === 'X') return (0x0000 + n);
    if (l === 'Y') return (0x0100 + n);
    if (l === 'M') return (0x0200 + n);
    if (l === 'T') return (0x0300 + n);
    if (l === 'C') return (0x0400 + n);
    return null;
  }

  /* ----------------------------------------------------------
     PUBLIC API
  ---------------------------------------------------------- */
  return {
    legacyToPaths: legacyToPaths,
    rungToAST:     rungToAST,
    validateRung:  validateRung,
    validateProgram: validateProgram,
    migrateRung:   migrateRung,
    migrateProgram: migrateProgram,
    FORMAT_VERSION: FORMAT_VERSION,
    astToIR:       astToIR
  };
}));
