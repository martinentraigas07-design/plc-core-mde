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

    // Fallback — treat unknown as a VAR
    return { op: 'VAR', var: (elem.var || elem.id || '') };
  }

  /* ----------------------------------------------------------
     4. validateRung(rung)
     ----------------------------------------------------------
     Returns an empty array if the rung is valid.
     Returns an array of error strings describing problems.
  ---------------------------------------------------------- */
  function validateRung(rung) {
    var errors = [];
    var normalised = legacyToPaths(rung);
    var paths   = normalised.paths   || [];
    var outputs = normalised.outputs || [];

    // COUNT only non-empty paths (paths with at least one element)
    var nonEmptyPaths = paths.filter(function(p){ return Array.isArray(p) && p.length > 0; });

    // EARLY EXIT: rung is in pristine/blank state — user hasn't touched it yet.
    // Do not report errors until the user actually edits something.
    // A rung is blank when it has no non-empty paths AND no outputs.
    if (nonEmptyPaths.length === 0 && outputs.length === 0) {
      return [];
    }

    // Rule 1: Must have at least one output (coil)
    if (outputs.length === 0) {
      errors.push('Rung has no output coil. Add at least one coil (Y, M, etc.).');
    }

    // Rule 2: Must have at least one path with content
    if (nonEmptyPaths.length === 0) {
      errors.push('Rung has no logic paths. Add at least one contact.');
    }

    // Rule 3: No empty paths mixed in with filled ones
    // (If ALL paths are empty, Rule 2 already covers it)
    if (nonEmptyPaths.length > 0) {
      paths.forEach(function(path, i) {
        if (!Array.isArray(path) || path.length === 0) {
          errors.push('Path ' + (i + 1) + ' is empty. Remove it or add a contact.');
        }
      });
    }

    // Rule 4: Coil must not appear inside a path (contacts only)
    paths.forEach(function(path, i) {
      (path || []).forEach(function(elem, j) {
        if (elem && elem.type === 'COIL') {
          errors.push('Path ' + (i+1) + ' position ' + (j+1) + ': coil found inside path. Coils must be outputs only.');
        }
      });
    });

    // Rule 5: All element variables must be non-empty
    var checkElem = function(elem, loc) {
      if (!elem) return;
      var v = elem.var || elem.id || '';
      if (!v) errors.push(loc + ': element has no variable address assigned.');
      // Validate variable name pattern (X/Y/M/T/C + digits)
      if (v && !/^[XYMTCxymtc]\d+$/.test(v)) {
        errors.push(loc + ': address "' + v + '" is not valid. Use X0, Y1, M3, T0, C0 etc.');
      }
    };

    paths.forEach(function(path, i) {
      (path || []).forEach(function(elem, j) {
        checkElem(elem, 'Path ' + (i+1) + ' pos ' + (j+1));
      });
    });

    outputs.forEach(function(coil, i) {
      checkElem(coil, 'Output ' + (i+1));
    });

    return errors;
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
    astToIR:       astToIR
  };
}));
