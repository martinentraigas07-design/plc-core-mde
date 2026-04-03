/* =============================================================
   PLC-CORE-MDE — Symbol Table v1
   =============================================================
   PURPOSE
   -------
   Translates a compiled IR (with address fields added by
   compiler.js) into a structured symbol table that maps
   every addressable PLC element to a canonical name,
   memory area, index and data type.

   This module is PURELY additive — it reads IR data and
   produces a new data structure.  It does NOT modify the IR,
   the runtime, or any existing data flow.

   PUBLIC API  (exposed as window.PlcSymbolTable)
   -----------------------------------------------
   PlcSymbolTable.build(irNodes)
     → { symbols: [...], stats: {...} }

   PlcSymbolTable.validate(irNodes)
     → { ok: bool, errors: [...], warnings: [...] }

   PlcSymbolTable.canonicalKey(fbdData)
     → string  — stable fingerprint of a Drawflow graph

   PlcSymbolTable.formatForEnvelope(symbolResult)
     → object ready to embed in program.json envelope

   AREA MAP
   --------
   X  — digital inputs    (BOOL)   source: input node name
   Y  — digital outputs   (BOOL)   source: output node name
   A  — analog inputs     (INT)    source: analog node name
   T  — timers            (TIMER)  source: ton/tof/tp/blink, by order
   C  — counters          (COUNTER)source: ctu/ctd, by order
   M  — memory bits       (BOOL)   source: sr/rs/r_trig/f_trig, by order

   NODES WITHOUT AN ADDRESS
   -------------------------
   and, or, not, xor, cmp  — combinational intermediates.
   These have no persistent state and no user-visible address.
   They are omitted from the symbol table intentionally.

   COLLISION GUARANTEE
   -------------------
   Within each area, every symbol has a unique index.
   Indices are assigned in stable order (Drawflow node IDs
   sorted ascending) so the same graph always produces the
   same assignments.

   FALLBACK COMPATIBILITY
   ----------------------
   Programs compiled WITHOUT address fields (pre-Bloque-1)
   are tolerated by validate() — they produce warnings, not
   errors, and the symbol table is built as a best-effort.
   =============================================================
*/

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PlcSymbolTable = factory();
}(typeof self !== 'undefined' ? self : this, function() {

  /* ----------------------------------------------------------
     AREA DEFINITIONS
     Each entry drives both address assignment and symbol type.
  ---------------------------------------------------------- */
  var AREA_DEFS = {
    // key: [ nodeTypes that map to this area ]
    X: { types: ['input1', 'input2'],               dataType: 'BOOL',    label: 'Digital Input'  },
    Y: { types: ['output1','output2','output3','output4'], dataType: 'BOOL', label: 'Digital Output' },
    A: { types: ['analog1'],                         dataType: 'INT',     label: 'Analog Input'   },
    T: { types: ['ton','tof','tp','blink'],           dataType: 'TIMER',   label: 'Timer'          },
    C: { types: ['ctu','ctd'],                       dataType: 'COUNTER', label: 'Counter'        },
    M: { types: ['sr','rs','r_trig','f_trig'],        dataType: 'BOOL',    label: 'Memory Bit'     }
    // NOTE: M uses a SINGLE shared index counter across all four node types.
    // sr, rs, r_trig, f_trig all share the M counter to prevent collisions.
    // First M-type node encountered (by ascending id) → M0, second → M1, etc.
    // R (registers) reserved for future use — no FBD nodes map to R yet
  };

  /* Fast reverse map: nodeType → area */
  var TYPE_TO_AREA = {};
  Object.keys(AREA_DEFS).forEach(function(area) {
    AREA_DEFS[area].types.forEach(function(t) { TYPE_TO_AREA[t] = area; });
  });

  /* For X and Y the index is encoded in the node type name,
     not assigned by a counter (input1→0, output3→2, etc.)   */
  var FIXED_INDEX_NODES = {
    input1:  { area: 'X', index: 0 },
    input2:  { area: 'X', index: 1 },
    output1: { area: 'Y', index: 0 },
    output2: { area: 'Y', index: 1 },
    output3: { area: 'Y', index: 2 },
    output4: { area: 'Y', index: 3 },
    analog1: { area: 'A', index: 0 }
  };

  /* Areas that use a sequential counter (not fixed by name) */
  var COUNTER_AREAS = ['T', 'C', 'M'];

  /* ----------------------------------------------------------
     build(irNodes)
     ----------------------------------------------------------
     irNodes — array of IR node objects as produced by
     compiler.js compileFBD().  Each node must have at minimum:
       { id, type }
     Nodes with an `address` field already set are trusted;
     nodes without are assigned addresses here as fallback.

     Returns:
     {
       symbols: [ { name, area, index, type, drawflowId,
                    nodeType, hasAddress } ],
       stats:   { total, byArea, missingAddress }
     }
  ---------------------------------------------------------- */
  function build(irNodes) {
    if (!Array.isArray(irNodes)) irNodes = [];

    /* Sort by id ascending for stable, deterministic assignment */
    var sorted = irNodes.slice().sort(function(a, b) {
      return (a.id || 0) - (b.id || 0);
    });

    /* Counters for areas that use sequential assignment */
    var counters = { T: 0, C: 0, M: 0 };

    var symbols = [];
    var stats   = { total: 0, byArea: {}, missingAddress: 0 };

    sorted.forEach(function(node) {
      var ntype = node.type || '';
      var area  = TYPE_TO_AREA[ntype];
      if (!area) return; // combinational node — skip

      var index;
      var hasAddress = (node.address &&
                        node.address.area !== undefined &&
                        node.address.index !== undefined);

      if (hasAddress) {
        /* Trust the address already embedded by the compiler */
        index = node.address.index;
      } else if (FIXED_INDEX_NODES[ntype]) {
        /* Fixed-index node: derive from type name */
        index = FIXED_INDEX_NODES[ntype].index;
        stats.missingAddress++;
      } else {
        /* Counter-area node without address: assign sequentially */
        index = counters[area]++;
        stats.missingAddress++;
      }

      var def  = AREA_DEFS[area];
      var name = area + index;           // canonical name: "T0", "M1", etc.

      symbols.push({
        name:       name,
        area:       area,
        index:      index,
        type:       def.dataType,
        label:      def.label,
        drawflowId: node.id,
        nodeType:   ntype,
        hasAddress: hasAddress
      });

      stats.total++;
      stats.byArea[area] = (stats.byArea[area] || 0) + 1;
    });

    return { symbols: symbols, stats: stats };
  }

  /* ----------------------------------------------------------
     validate(irNodes)
     ----------------------------------------------------------
     Runs structural integrity checks on the IR node array.

     ERROR levels:
       CRITICAL  — blocks save; logic would be wrong
       WARNING   — allows save; informs developer

     Returns:
     {
       ok:       bool,      // false if any CRITICAL error
       errors:   [ { level, code, message, nodeId? } ],
       warnings: [ { code, message, nodeId? } ]
     }
  ---------------------------------------------------------- */
  function validate(irNodes) {
    if (!Array.isArray(irNodes)) irNodes = [];

    var errors   = [];
    var warnings = [];

    /* ── Check 1: address collision within each area ────── */
    var seen = {}; // "AREA:index" → first nodeId that claimed it
    irNodes.forEach(function(node) {
      if (!node.address) return;
      var key = node.address.area + ':' + node.address.index;
      if (seen[key] !== undefined) {
        errors.push({
          level:   'CRITICAL',
          code:    'ADDR_COLLISION',
          message: 'Address ' + node.address.area + node.address.index +
                   ' assigned to both node ' + seen[key] +
                   ' and node ' + node.id,
          nodeId:  node.id
        });
      } else {
        seen[key] = node.id;
      }
    });

    /* ── Check 2: index out of declared memory bounds ───── */
    var MEM_SIZES = { X:64, Y:64, M:64, T:32, C:32, A:16, R:32 };
    irNodes.forEach(function(node) {
      if (!node.address) return;
      var area  = node.address.area;
      var index = node.address.index;
      var max   = MEM_SIZES[area];
      if (max === undefined) {
        warnings.push({
          code:    'UNKNOWN_AREA',
          message: 'Node ' + node.id + ' references unknown area "' + area + '"',
          nodeId:  node.id
        });
      } else if (index < 0 || index >= max) {
        errors.push({
          level:   'CRITICAL',
          code:    'ADDR_OUT_OF_RANGE',
          message: 'Node ' + node.id + ': ' + area + index +
                   ' exceeds area size ' + max,
          nodeId:  node.id
        });
      }
    });

    /* ── Check 3: nodes missing address field (warning) ─── */
    var addressableTypes = Object.keys(TYPE_TO_AREA);
    irNodes.forEach(function(node) {
      var ntype = node.type || '';
      if (addressableTypes.indexOf(ntype) >= 0 && !node.address) {
        warnings.push({
          code:    'MISSING_ADDRESS',
          message: 'Addressable node ' + node.id + ' (' + ntype + ') ' +
                   'has no address field — using legacy id%size fallback',
          nodeId:  node.id
        });
      }
    });

    /* ── Check 4: topological order sanity ──────────────── */
    /* A minimal cycle check: if any node references itself */
    irNodes.forEach(function(node) {
      if (node.in1 === node.id || node.in2 === node.id) {
        errors.push({
          level:   'CRITICAL',
          code:    'SELF_LOOP',
          message: 'Node ' + node.id + ' references itself as input',
          nodeId:  node.id
        });
      }
    });

    /* ── Check 5: output nodes without a driving input ──── */
    var outputTypes = ['output1','output2','output3','output4'];
    irNodes.forEach(function(node) {
      if (outputTypes.indexOf(node.type) >= 0) {
        if (node.in1 === null || node.in1 === undefined) {
          warnings.push({
            code:    'UNDRIVEN_OUTPUT',
            message: 'Output node ' + node.id + ' (' + node.type + ') ' +
                     'has no driving input — output will always be OFF',
            nodeId:  node.id
          });
        }
      }
    });

    return {
      ok:       errors.length === 0,
      errors:   errors,
      warnings: warnings
    };
  }

  /* ----------------------------------------------------------
     canonicalKey(fbdData)
     ----------------------------------------------------------
     Produces a stable string fingerprint of a Drawflow graph
     that is independent of JSON key ordering, whitespace, and
     the address fields added by the compiler.

     The key is built from: sorted node IDs + node types +
     sorted connection pairs.  It changes only if the graph
     topology changes (nodes added/removed/reconnected).

     This is intentionally NOT a cryptographic hash — it is
     a human-readable deterministic string that can be stored
     and compared cheaply.
  ---------------------------------------------------------- */
  function canonicalKey(fbdData) {
    try {
      var doc  = typeof fbdData === 'string' ? JSON.parse(fbdData) : fbdData;
      var data = doc && doc.drawflow && doc.drawflow.Home && doc.drawflow.Home.data;
      if (!data) return 'empty';

      var nodeKeys = Object.keys(data).map(function(k) {
        return parseInt(k, 10);
      }).sort(function(a, b) { return a - b; });

      var parts = nodeKeys.map(function(id) {
        var node = data[id];
        if (!node) return '';

        /* Collect outgoing connections sorted for stability */
        var conns = [];
        var outs  = node.outputs || {};
        Object.keys(outs).forEach(function(port) {
          (outs[port].connections || []).forEach(function(c) {
            conns.push(String(c.node));
          });
        });
        conns.sort();

        return id + ':' + (node.name || '?') + '[' + conns.join(',') + ']';
      });

      return parts.join('|');
    } catch(e) {
      return 'error:' + e.message;
    }
  }

  /* ----------------------------------------------------------
     formatForEnvelope(buildResult, canonicalKey, source)
     ----------------------------------------------------------
     Produces the object that goes into program.json under the
     key "symbolTable".  This is the persisted form.
  ---------------------------------------------------------- */
  function formatForEnvelope(buildResult, ck, source) {
    return {
      version:      1,
      source:       source || 'fbd',
      generated:    new Date().toISOString(),
      canonicalKey: ck || '',
      symbols:      buildResult.symbols,
      stats:        buildResult.stats
    };
  }

  /* ----------------------------------------------------------
     PUBLIC API
  ---------------------------------------------------------- */
  return {
    build:             build,
    validate:          validate,
    canonicalKey:      canonicalKey,
    formatForEnvelope: formatForEnvelope,
    /* Expose area map for tools / monitor */
    AREA_DEFS:         AREA_DEFS,
    TYPE_TO_AREA:      TYPE_TO_AREA
  };

}));
