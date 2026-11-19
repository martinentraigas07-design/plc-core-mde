/* PLC-CORE-MDE — Proyectos portables ".plc" (formato plc_project, versión 1)
 *
 * Contenedor EXTERNO: es un JSON que envuelve el diagrama editable (FBD o Ladder) y, como caché informativa, el IR
 * compilado. NO reemplaza el formato interno del firmware (envelope plc_program v2/v3 que se envía a /save).
 * Al importar, el IR del archivo NUNCA se envía al PLC: cada página recompila el diagrama con su propio compilador
 * y compara el resultado con el IR del archivo (PlcProject.irKey).
 *
 * Este módulo es puro (sin DOM ni red) salvo los helpers de navegador del final (download / readFile).
 * No usa eval, Function ni innerHTML. Valida estructura, versión, límites y el HTML de los nodos FBD con una lista
 * blanca (si algo no encaja, el archivo se rechaza: nunca se "arregla" en silencio).
 *
 * No es PLCopen XML ni IEC 61131-10.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PlcProject = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'plc_project';
  var FORMAT_VERSION = 1;
  var TOOL_VERSION = '6.2.0-rc.1';
  var MAX_FILE_BYTES = 262144;     // 256 KiB (un programa de 64 nodos ronda los 80 KB)
  var MAX_NODES = 64;              // = MAX_NODES de plc_runtime.h (el firmware ignora los nodos que sobren: aquí se rechaza)
  var MAX_RUNGS = 128;
  var MAX_DEPTH = 40;
  var MAX_STRING = 400;
  var NAME_MAX = 48;
  var EXTENSION = '.plc';

  // Tipos de nodo que crea editor.js (y que entiende el compilador/firmware).
  var FBD_TYPES = ['input1', 'input2', 'output1', 'output2', 'output3', 'output4', 'analog1', 'pwm', 'and', 'or', 'not', 'xor', 'cmp',
    'ton', 'tof', 'tp', 'blink', 'ctu', 'ctd', 'sr', 'rs', 'r_trig', 'f_trig', 'scale'];
  var FORBIDDEN_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  /* ---------- utilidades ---------- */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  var _crcTable = null;
  function crc32(str) {
    if (!_crcTable) {
      _crcTable = [];
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcTable[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      crc = _crcTable[(crc ^ (ch & 0xFF)) & 0xFF] ^ (crc >>> 8);
      crc = _crcTable[(crc ^ (ch >>> 8)) & 0xFF] ^ (crc >>> 8);
    }
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
  }
  function sanitizeName(s) {
    s = String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f<>"'`&\\\/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
    return s || 'Proyecto';
  }
  function fileNameFor(name) {
    var base = sanitizeName(name).normalize ? sanitizeName(name).normalize('NFD').replace(/[̀-ͯ]/g, '') : sanitizeName(name);
    base = base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Proyecto';
    return base + EXTENSION;
  }

  /* Recorre el árbol rechazando claves peligrosas, profundidad excesiva, tipos no JSON y cadenas enormes. */
  function deepScan(v, errors, where, depth) {
    if (depth > MAX_DEPTH) { errors.push(where + ': anidamiento excesivo'); return; }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!isFinite(v)) errors.push(where + ': número no finito'); return; }
    if (typeof v === 'string') { if (v.length > 20000) errors.push(where + ': cadena demasiado larga'); return; }
    if (Array.isArray(v)) { for (var i = 0; i < v.length && errors.length < 20; i++) deepScan(v[i], errors, where + '[' + i + ']', depth + 1); return; }
    if (isObj(v)) {
      Object.keys(v).forEach(function (k) {
        if (errors.length >= 20) return;
        if (FORBIDDEN_KEYS[k]) { errors.push(where + ': clave no permitida "' + k + '"'); return; }
        deepScan(v[k], errors, where + '.' + k, depth + 1);
      });
      return;
    }
    errors.push(where + ': tipo no permitido (' + typeof v + ')');
  }

  /* ---------- HTML de nodos FBD: lista blanca estricta, falla cerrado ---------- */
  var TAGS_CLOSE = /^<\/(div|select|option)>/;
  var TAG_OPEN = /^<(div|br|select|option|input)((?:\s+[A-Za-z][A-Za-z0-9_-]*(?:="[^"]*")?)*)\s*\/?>/;
  var ATTR = /\s+([A-Za-z][A-Za-z0-9_-]*)(?:="([^"]*)")?/g;
  function safeNodeHtml(html) {
    if (typeof html !== 'string') return { ok: false, why: 'html no es texto' };
    if (html.length > 2000) return { ok: false, why: 'html demasiado largo' };
    var i = 0;
    while (i < html.length) {
      var lt = html.indexOf('<', i);
      if (lt < 0) break;                       // texto restante (sin '<' no puede formar etiquetas)
      var rest = html.slice(lt);
      // Un '<' que no va seguido de letra, '/', '!' o '?' es TEXTO para el analizador HTML (p. ej. «<option value="<"><</option>» de CMP).
      if (!/^<[A-Za-z\/!?]/.test(rest)) { i = lt + 1; continue; }
      var m = TAGS_CLOSE.exec(rest);
      if (m) { i = lt + m[0].length; continue; }
      m = TAG_OPEN.exec(rest);
      if (!m) return { ok: false, why: 'etiqueta no permitida: ' + rest.slice(0, 20).replace(/\s+/g, ' ') };
      var a, attrs = m[2] || '';
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(attrs)) !== null) {
        var an = a[1].toLowerCase(), av = a[2];
        if (an.indexOf('df-') === 0) { if (!/^df-[A-Za-z0-9_]+$/.test(a[1]) || av !== undefined && av.length > 200) return { ok: false, why: 'atributo ' + a[1] }; continue; }
        if (an === 'style') { if (av === undefined || !/^[A-Za-z0-9:;%.,#\s-]*$/.test(av)) return { ok: false, why: 'style no permitido' }; continue; }
        if (an === 'class') { if (av === undefined || !/^[A-Za-z0-9_ -]{0,60}$/.test(av)) return { ok: false, why: 'class no permitido' }; continue; }
        if (an === 'type') { if (av !== 'number') return { ok: false, why: 'input type no permitido' }; continue; }
        if (an === 'value' || an === 'min' || an === 'max' || an === 'step') { if (av === undefined || av.length > 40) return { ok: false, why: 'atributo ' + an }; continue; }
        if (an === 'selected') continue;
        return { ok: false, why: 'atributo no permitido: ' + an };   // incluye on*, href, src, srcdoc, etc.
      }
      i = lt + m[0].length;
    }
    return { ok: true };
  }

  /* ---------- validación del diagrama FBD (Drawflow) ---------- */
  function checkFbd(fbd, errors) {
    var nodeCount = 0;
    if (!isObj(fbd) || !isObj(fbd.drawflow) || !isObj(fbd.drawflow.Home) || !isObj(fbd.drawflow.Home.data)) { errors.push('El diagrama FBD no tiene drawflow.Home.data.'); return 0; }
    var data = fbd.drawflow.Home.data, keys = Object.keys(data);
    nodeCount = keys.length;
    if (nodeCount === 0) { errors.push('El diagrama FBD está vacío.'); return 0; }
    if (nodeCount > MAX_NODES) { errors.push('El diagrama tiene ' + nodeCount + ' nodos; el PLC admite como máximo ' + MAX_NODES + '.'); return nodeCount; }
    var ids = {};
    keys.forEach(function (k) { ids[k] = true; });
    keys.forEach(function (k) {
      if (errors.length >= 20) return;
      var n = data[k], w = 'nodo ' + k;
      if (!/^[0-9]{1,6}$/.test(k)) { errors.push(w + ': identificador inválido'); return; }
      if (!isObj(n)) { errors.push(w + ': no es un objeto'); return; }
      if (String(n.id) !== k) errors.push(w + ': id no coincide con la clave');
      if (typeof n.name !== 'string' || FBD_TYPES.indexOf(n.name) < 0) { errors.push(w + ': tipo desconocido "' + String(n.name).slice(0, 20) + '"'); return; }
      if (typeof n.class !== 'string' || !/^[A-Za-z0-9_ -]{1,40}$/.test(n.class)) errors.push(w + ': class inválida');
      if (n.typenode !== undefined && n.typenode !== false) errors.push(w + ': typenode no permitido');
      var h = safeNodeHtml(n.html); if (!h.ok) errors.push(w + ': ' + h.why);
      if (n.pos_x !== undefined && (typeof n.pos_x !== 'number' || !isFinite(n.pos_x))) errors.push(w + ': pos_x inválida');
      if (n.pos_y !== undefined && (typeof n.pos_y !== 'number' || !isFinite(n.pos_y))) errors.push(w + ': pos_y inválida');
      if (n.data !== undefined) {
        if (!isObj(n.data)) errors.push(w + ': data inválida');
        else Object.keys(n.data).forEach(function (dk) {
          var dv = n.data[dk];
          if (!/^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(dk)) errors.push(w + ': clave de datos inválida');
          else if (!(typeof dv === 'string' && dv.length <= 40 || typeof dv === 'number' && isFinite(dv) || typeof dv === 'boolean')) errors.push(w + ': valor de datos inválido en ' + dk);
        });
      }
      ['inputs', 'outputs'].forEach(function (side) {
        var o = n[side]; if (o === undefined) return;
        if (!isObj(o)) { errors.push(w + ': ' + side + ' inválido'); return; }
        var pre = side === 'inputs' ? 'input_' : 'output_';
        Object.keys(o).forEach(function (pk) {
          if (!/^(input|output)_[0-9]{1,2}$/.test(pk) || pk.indexOf(pre) !== 0) { errors.push(w + ': puerto inválido "' + pk.slice(0, 12) + '"'); return; }
          var cons = o[pk] && o[pk].connections;
          if (!Array.isArray(cons)) { errors.push(w + ': ' + pk + ' sin lista de conexiones'); return; }
          if (cons.length > 64) { errors.push(w + ': demasiadas conexiones'); return; }
          cons.forEach(function (c) {
            var target = isObj(c) ? String(c.node) : '';
            var port = isObj(c) ? (c.input !== undefined ? c.input : c.output) : undefined;
            if (!ids[target]) errors.push(w + ': conexión a un nodo inexistente (' + target.slice(0, 8) + ')');
            else if (typeof port !== 'string' || !/^(input|output)_[0-9]{1,2}$/.test(port)) errors.push(w + ': puerto de conexión inválido');
          });
        });
      });
    });
    return nodeCount;
  }

  /* ---------- validación del diagrama Ladder ---------- */
  var LADDER_IDENT_KEYS = ['var', 'id', 'src', 'src2', 'fn', 'blockType', 'type', 'mode', 'op', 'cmpOp', 'edge', 'kind', 'name', 'dir', 'unit'];
  function checkLadderValue(v, errors, where, depth, key) {
    if (errors.length >= 20) return;
    if (depth > MAX_DEPTH) { errors.push(where + ': anidamiento excesivo'); return; }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!isFinite(v)) errors.push(where + ': número no finito'); return; }
    if (typeof v === 'string') {
      if (key === 'comment') { if (v.length > 200) errors.push(where + ': comentario demasiado largo'); return; }
      if (LADDER_IDENT_KEYS.indexOf(key) >= 0 && !/^[A-Za-z0-9_.<>=!+-]{0,32}$/.test(v)) errors.push(where + ': valor inválido en "' + key + '"');
      else if (v.length > MAX_STRING) errors.push(where + ': cadena demasiado larga');
      return;
    }
    if (Array.isArray(v)) { v.forEach(function (x, i) { checkLadderValue(x, errors, where + '[' + i + ']', depth + 1, key); }); return; }
    if (isObj(v)) {
      Object.keys(v).forEach(function (k) {
        if (FORBIDDEN_KEYS[k]) { errors.push(where + ': clave no permitida "' + k + '"'); return; }
        if (!/^[A-Za-z][A-Za-z0-9_]{0,24}$/.test(k)) { errors.push(where + ': nombre de campo inválido'); return; }
        checkLadderValue(v[k], errors, where + '.' + k, depth + 1, k);
      });
      return;
    }
    errors.push(where + ': tipo no permitido');
  }
  function checkLadder(ladder, errors, astLib) {
    if (!isObj(ladder) || !Array.isArray(ladder.rungs)) { errors.push('El diagrama Ladder no tiene lista de renglones.'); return 0; }
    var n = ladder.rungs.length;
    if (n === 0) { errors.push('El diagrama Ladder no tiene renglones.'); return 0; }
    if (n > MAX_RUNGS) { errors.push('El Ladder tiene ' + n + ' renglones; el máximo admitido es ' + MAX_RUNGS + '.'); return n; }
    if (ladder.formatVersion !== undefined && (!isFinite(ladder.formatVersion) || Math.floor(ladder.formatVersion) !== ladder.formatVersion || ladder.formatVersion < 1)) errors.push('ladder.formatVersion inválido.');
    ladder.rungs.forEach(function (r, i) {
      if (!isObj(r)) { errors.push('Renglón ' + (i + 1) + ': no es un objeto.'); return; }
      checkLadderValue(r, errors, 'renglón ' + (i + 1), 0, '');
    });
    if (astLib && !errors.length && ladder.formatVersion > astLib.FORMAT_VERSION)
      errors.push('El Ladder usa el formato v' + ladder.formatVersion + ', más nuevo que este editor (v' + astLib.FORMAT_VERSION + ').');
    return n;
  }

  /* ---------- IR (informativo) ---------- */
  function checkIr(ir, errors, warnings) {
    if (ir === null || ir === undefined) return false;
    if (!isObj(ir) || !isObj(ir.program) || !Array.isArray(ir.program.nodes)) { warnings.push('El IR compilado del archivo no tiene la forma esperada; se ignora y se recompila.'); return false; }
    if (ir.program.nodes.length > MAX_NODES) { errors.push('El IR tiene ' + ir.program.nodes.length + ' nodos; el PLC admite ' + MAX_NODES + '.'); return false; }
    return true;
  }
  /* Clave canónica de un IR para comparar compilaciones (sin fecha ni metadatos). */
  function irKey(ir) {
    if (!ir || !ir.program || !Array.isArray(ir.program.nodes)) return null;
    return JSON.stringify(ir.program.nodes);
  }

  /* ---------- construir ---------- */
  function build(o) {
    o = o || {};
    var ed = o.editor === 'ladder' ? 'ladder' : 'fbd';
    var diagram = ed === 'ladder' ? { ladder: o.ladder } : { fbd: o.fbd };
    var proj = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      generator: { name: 'PLC-CORE-MDE', toolVersion: TOOL_VERSION, origin: o.origin === 'esp32' ? 'esp32' : 'simulator' },
      project: { name: sanitizeName(o.name), description: String(o.description || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) },
      editor: ed,
      compat: {
        target: 'PLC-CORE-MDE',
        envelope: { format: 'plc_program', version: ed === 'ladder' ? 3 : 2 },
        irVersion: (o.ir && o.ir.meta && o.ir.meta.version) || null,
        ladderFormatVersion: ed === 'ladder' ? ((o.ladder && o.ladder.formatVersion) || null) : null,
        maxNodes: MAX_NODES
      },
      diagram: diagram,
      ir: o.ir ? { format: o.ir.format, meta: stripIrMeta(o.ir.meta), memory: o.ir.memory, program: o.ir.program, order: o.ir.order } : null,
      symbolTable: stripGenerated(o.symbolTable || (o.ir && o.ir.meta && o.ir.meta.symbolTable) || null)
    };
    if (proj.ir && proj.ir.meta) delete proj.ir.meta.symbolTable;
    proj.checksum = { algorithm: 'crc32', covers: 'diagram+ir', value: checksumOf(proj) };
    return proj;
  }
  function stripGenerated(st) {   // la tabla de símbolos trae la fecha de generación: se quita para que el archivo sea reproducible
    if (!st || typeof st !== 'object') return null;
    var c = {}; Object.keys(st).forEach(function (k) { if (k !== 'generated') c[k] = st[k]; });
    return c;
  }
  function stripIrMeta(meta) {
    if (!meta) return {};
    var m = {}; Object.keys(meta).forEach(function (k) { if (k !== 'compiled') m[k] = meta[k]; });   // sin fecha: archivos reproducibles
    return m;
  }
  function checksumOf(p) { return crc32(JSON.stringify({ diagram: p.diagram, ir: p.ir })); }
  function serialize(p) { return JSON.stringify(p); }

  /* ---------- parsear / validar (no modifica nada fuera) ---------- */
  function fail(errors, warnings) { return { ok: false, errors: errors, warnings: warnings || [] }; }
  function parse(text, opts) {
    opts = opts || {};
    var errors = [], warnings = [];
    if (typeof text !== 'string') return fail(['El contenido del archivo no es texto.']);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var maxBytes = opts.maxBytes || MAX_FILE_BYTES;
    if (utf8Len(text) > maxBytes) return fail(['El archivo es demasiado grande (' + utf8Len(text) + ' bytes; máximo ' + maxBytes + ').']);
    if (!text.trim()) return fail(['El archivo está vacío.']);
    var data;
    try { data = JSON.parse(text); } catch (e) { return fail(['El archivo no es un JSON válido (' + String(e.message).slice(0, 80) + '). Puede estar corrupto o truncado.']); }
    if (!isObj(data)) return fail(['El archivo no contiene un proyecto (se esperaba un objeto).']);
    var scan = []; deepScan(data, scan, 'archivo', 0);
    if (scan.length) return fail(['Contenido no permitido: ' + scan[0]]);

    var legacy = false;
    if (data.format !== FORMAT) {
      var w = wrapLegacy(data);
      if (!w) return fail(['No es un proyecto PLC-CORE-MDE (".plc"): falta format="' + FORMAT + '".']);
      data = w; legacy = true;
      warnings.push('Archivo en un formato anterior (' + w._legacyKind + '): se importó el diagrama sin sumas de verificación.');
    }
    if (!legacy) {
      if (typeof data.formatVersion !== 'number' || Math.floor(data.formatVersion) !== data.formatVersion || data.formatVersion < 1) return fail(['formatVersion ausente o inválida.']);
      if (data.formatVersion > FORMAT_VERSION) return fail(['El proyecto usa el formato .plc v' + data.formatVersion + ', más nuevo que este editor (v' + FORMAT_VERSION + '). Actualizá el firmware/web del PLC.']);
    }
    if (data.editor !== 'fbd' && data.editor !== 'ladder') return fail(['Tipo de editor desconocido ("' + String(data.editor).slice(0, 12) + '"); se esperaba fbd o ladder.']);
    var pr = isObj(data.project) ? data.project : {};
    var name = sanitizeName(pr.name);
    if (!isObj(data.project) || typeof pr.name !== 'string') warnings.push('El proyecto no trae nombre; se usará "' + name + '".');
    if (!isObj(data.diagram)) return fail(['Falta el diagrama editable (diagram).']);

    var count = 0;
    if (data.editor === 'fbd') count = checkFbd(data.diagram.fbd, errors);
    else count = checkLadder(data.diagram.ladder, errors, opts.ladderAst);
    var irOk = checkIr(data.ir, errors, warnings);
    if (errors.length) return fail(errors, warnings);

    if (!legacy) {
      if (!isObj(data.checksum) || data.checksum.algorithm !== 'crc32' || typeof data.checksum.value !== 'string') warnings.push('El archivo no tiene suma de verificación; no se puede comprobar su integridad.');
      else if (data.checksum.value !== checksumOf(data)) return fail(['La suma de verificación no coincide: el archivo está corrupto o fue modificado.'], warnings);
      if (isObj(data.compat) && data.compat.target && data.compat.target !== 'PLC-CORE-MDE') return fail(['El proyecto es para otro destino ("' + String(data.compat.target).slice(0, 20) + '").'], warnings);
    }
    return {
      ok: true, errors: [], warnings: warnings, legacy: legacy,
      project: { name: name, description: typeof pr.description === 'string' ? pr.description.slice(0, 200) : '', editor: data.editor,
        diagram: data.diagram, ir: irOk ? data.ir : null, symbolTable: data.symbolTable || null,
        origin: isObj(data.generator) && data.generator.origin === 'esp32' ? 'esp32' : 'simulator' },
      summary: { name: name, editor: data.editor, formatVersion: legacy ? 0 : data.formatVersion, count: count, unit: data.editor === 'fbd' ? 'nodos' : 'renglones', legacy: legacy }
    };
  }

  /* JSON anteriores aceptados al importar: Ladder exportado ("ladder-pro" o con rungs) y envelopes plc_program guardados en el PLC. */
  function wrapLegacy(d) {
    if (d.format === 'ladder-pro' && Array.isArray(d.rungs)) return { editor: 'ladder', project: { name: 'Ladder importado' }, diagram: { ladder: { formatVersion: d.version || 3, rungs: d.rungs } }, _legacyKind: 'JSON Ladder' };
    if (Array.isArray(d.rungs) && !d.format) return { editor: 'ladder', project: { name: 'Ladder importado' }, diagram: { ladder: { formatVersion: d.version || 3, rungs: d.rungs } }, _legacyKind: 'JSON Ladder' };
    if (d.format === 'plc_program') {
      if (isObj(d.ladder) && Array.isArray(d.ladder.rungs)) return { editor: 'ladder', project: { name: 'Ladder del PLC' }, diagram: { ladder: d.ladder }, ir: d.ir || null, _legacyKind: 'programa guardado en el PLC' };
      if (isObj(d.fbd)) return { editor: 'fbd', project: { name: 'FBD del PLC' }, diagram: { fbd: d.fbd }, ir: d.ir || null, _legacyKind: 'programa guardado en el PLC' };
    }
    return null;
  }

  /* ---------- helpers de navegador ---------- */
  function download(filename, text) {
    var a = document.createElement('a');
    var blob = new Blob([text], { type: 'application/json' });
    a.href = URL.createObjectURL(blob); a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) {} }, 0);
    return blob;
  }
  /* Lee el archivo local como texto; rechaza por tamaño ANTES de leerlo. */
  function readFile(file, maxBytes) {
    maxBytes = maxBytes || MAX_FILE_BYTES;
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('No se eligió ningún archivo.')); return; }
      if (file.size > maxBytes) { reject(new Error('El archivo es demasiado grande (' + file.size + ' bytes; máximo ' + maxBytes + ').')); return; }
      var rd = new FileReader();
      rd.onload = function () { resolve(String(rd.result)); };
      rd.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      rd.readAsText(file);
    });
  }
  function isEmbedded() { return typeof PlcApi !== 'undefined' && !!PlcApi.isEmbedded; }
  /* Nombre del destino para mensajes: en el simulador NO hay hardware. */
  function targetName() { return isEmbedded() ? 'el PLC (ESP32)' : 'el PLC SIMULADO (no es hardware)'; }

  return {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, TOOL_VERSION: TOOL_VERSION, EXTENSION: EXTENSION,
    MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_NODES: MAX_NODES, MAX_RUNGS: MAX_RUNGS, FBD_TYPES: FBD_TYPES,
    build: build, serialize: serialize, parse: parse, irKey: irKey, crc32: crc32,
    sanitizeName: sanitizeName, fileNameFor: fileNameFor, safeNodeHtml: safeNodeHtml,
    download: download, readFile: readFile, isEmbedded: isEmbedded, targetName: targetName
  };
}));
