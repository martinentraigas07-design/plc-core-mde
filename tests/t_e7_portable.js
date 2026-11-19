'use strict';
// E7 FINAL — Proyectos portables ".plc" (formato plc_project v1): exportar/importar desde FBD y Ladder, simulador ↔ servidor embebido.
// Cubre: ida y vuelta FBD/Ladder, preservación de conexiones/parámetros/nombres, compilación equivalente, JSON Ladder anterior,
// rechazo de archivos corruptos/incompatibles/enormes/hostiles, protección del programa anterior, ausencia de sobrescritura automática,
// sincronización de firmware/data y ausencia de dependencias de Internet. Los programas importados se ejecutan en el firmware REAL
// compilado en el host y en el simulador. NO prueba el ESP32 físico.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const H = require('./harness'); const { check, program, runFirmware, runSim } = H;
const L = require('./portable_lib'); const { R, D, bootPage, tick, buildTankFbd, buildTankLadder, TANK_STEPS, out4 } = L;
const PP = require('../js/project/plc_project.js');
const EX = path.join(R, 'examples');
const rd = f => fs.readFileSync(f, 'utf8');
const hasHost = fs.existsSync(path.join(__dirname, 'hostfw/fwhost'));

// ───────── A. Estático ─────────
{
  const b = spawnSync('node', [path.join(R, 'tools/build_web.js'), '--check'], { encoding: 'utf8' });
  check('A1 firmware/data coincide con lo que genera tools/build_web.js', b.status === 0, (b.stdout + b.stderr).trim().slice(0, 160));
  const files = fs.readdirSync(D);
  check('A2 plc_project.js está en firmware/data (nombre ≤ 31) y lo cargan program.html y ladder.html', files.includes('plc_project.js') &&
    ['program.html', 'ladder.html'].every(p => /src="plc_project\.js"/.test(rd(path.join(D, p))) && /src="js\/project\/plc_project\.js"/.test(rd(path.join(R, p)))));
  const ids = ['btn-save-plc', 'btn-export', 'btn-import', 'proj-name', 'proj-msg', 'proj-file'];
  check('A3 FBD y Ladder tienen los tres botones (Guardar en PLC / Exportar proyecto / Importar proyecto), nombre y área de mensajes (raíz y data)',
    ['program.html', 'ladder.html'].every(p => [R, D].every(d => ids.every(i => rd(path.join(d, p)).includes('id="' + i + '"')))));
  const src = rd(path.join(R, 'js/project/plc_project.js'));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bad = [/https?:\/\//, /\beval\s*\(/, /\bnew Function\b/, /\binnerHTML\b/, /\bXMLHttpRequest\b/, /\bfetch\s*\(/, /\bdocument\.write\b/, /\bimportScripts\b/].filter(r => r.test(code));
  check('A4 plc_project.js: sin Internet, sin eval/Function/innerHTML/fetch (no ejecuta contenido importado)', bad.length === 0, bad.join(' '));
  const info = JSON.parse(rd(path.join(D, 'build_info.json')));
  check('A5 SPIFFS: total ≤ 1 MB, estimación ≤ 70 % y quedan ≥ 2 × 80 KB libres', info.totalBytes <= 1000000 && info.estimatedSpiffsBytes <= 0.7 * 1507328 && 1507328 - info.estimatedSpiffsBytes >= 2 * 80 * 1024,
    `total=${info.totalBytes} spiffs≈${info.estimatedSpiffsBytes}`);
  // todos los tipos de nodo que crea editor.js (y con los que el compilador genera html) están en la lista blanca
  const ed = rd(path.join(R, 'editor.js'));
  const names = new Set([...ed.matchAll(/editor\.addNode\(\s*'([a-z_0-9]+)'/g)].map(m => m[1]));
  check('A6 la lista blanca de tipos FBD cubre todos los nodos de editor.js (' + names.size + ')', names.size >= 24 && [...names].every(n => PP.FBD_TYPES.includes(n)), [...names].filter(n => !PP.FBD_TYPES.includes(n)).join(','));
  check('A7 hay al menos un ejemplo FBD y uno Ladder en examples/', fs.existsSync(path.join(EX, 'Control_Tanque_FBD.plc')) && fs.existsSync(path.join(EX, 'Control_Tanque_Ladder.plc')));
  const ex = spawnSync('node', [path.join(R, 'tools/make_examples.js'), '--check'], { encoding: 'utf8' });
  check('A8 los ejemplos .plc coinciden con lo que regenera tools/make_examples.js (reproducibles)', ex.status === 0, (ex.stdout + ex.stderr).trim().slice(0, 160));
}

// ───────── B. Formato y validación (unitario) ─────────
const fbdProg = () => {
  const p = program([{ id: 1, name: 'input1' }, { id: 2, name: 'input2' }, { id: 3, name: 'rs' }, { id: 4, name: 'output1' }], [[1, 3, 1], [2, 3, 2], [3, 4]]);
  const d = p.drawflow.Home.data; const ins = { 3: 2, 4: 1 };
  Object.values(d).forEach(n => { n.html = '<div>' + n.name + '</div>'; for (let i = 1; i <= (ins[n.id] || 0); i++) n.inputs['input_' + i] = { connections: [] }; });
  for (const n of Object.values(d)) for (const c of n.outputs.output_1.connections) d[c.node].inputs[c.output].connections.push({ node: String(n.id), input: 'output_1' });
  return p;
};
const ladProg = () => ({ formatVersion: 4, rungs: [{ id: 'r1', comment: 'arranque', paths: [[{ type: 'CONTACT', var: 'X0', negated: false }]], outputs: [{ type: 'COIL', var: 'Y0', mode: 'SET' }] }] });
const mk = (editor, over) => { const p = editor === 'fbd' ? PP.build({ name: 'T', editor: 'fbd', fbd: fbdProg() }) : PP.build({ name: 'T', editor: 'ladder', ladder: ladProg() }); return over ? over(p) : p; };
const ser = p => JSON.stringify(p);
const reseal = p => { p.checksum.value = PP.crc32(JSON.stringify({ diagram: p.diagram, ir: p.ir })); return p; };
{
  const f = PP.parse(PP.serialize(mk('fbd'))), l = PP.parse(PP.serialize(mk('ladder')), {});
  check('B1 ida y vuelta del contenedor FBD y Ladder (build → serialize → parse)', f.ok && l.ok && f.project.editor === 'fbd' && l.project.editor === 'ladder' &&
    JSON.stringify(f.project.diagram.fbd) === JSON.stringify(fbdProg()) && JSON.stringify(l.project.diagram.ladder) === JSON.stringify(ladProg()), JSON.stringify(f.errors.concat(l.errors)));
  const o = mk('fbd');
  check('B2 el contenedor declara formato, versión, editor, compatibilidad y nombre', o.format === 'plc_project' && o.formatVersion === 1 && o.editor === 'fbd' && o.compat.target === 'PLC-CORE-MDE' &&
    o.compat.envelope.format === 'plc_program' && o.compat.maxNodes === 64 && o.project.name === 'T' && o.checksum.algorithm === 'crc32');
  const txt = PP.serialize(mk('fbd'));
  check('B3 sin fechas ni estado de ejecución (reproducible, no mezcla estado temporal con el programa)', !/"compiled"|intValue|timerRunning|elapsed|"state"/.test(txt) && PP.serialize(mk('fbd')) === txt);
  const t1 = JSON.parse(txt); t1.diagram.fbd.drawflow.Home.data['3'].pos_x = 99;   // alterar un byte sin recalcular la suma
  const r1 = PP.parse(ser(t1));
  check('B4 la suma de verificación detecta archivos alterados o corruptos', !r1.ok && /suma de verificaci/.test(r1.errors[0]), r1.errors[0]);
  const t2 = JSON.parse(txt); delete t2.checksum; const r2 = PP.parse(ser(t2));
  check('B5 sin suma de verificación se acepta pero con advertencia', r2.ok && r2.warnings.some(w => /suma de verificaci/.test(w)));
}
{
  const rej = (name, text, rx, opts) => { const r = PP.parse(text, opts); check('B6 rechazo: ' + name, !r.ok && (!rx || rx.test(r.errors.join(' '))), r.ok ? 'FUE ACEPTADO' : r.errors[0]); };
  const base = () => JSON.parse(PP.serialize(mk('fbd'))), baseL = () => JSON.parse(PP.serialize(mk('ladder')));
  const w = (o, fix) => ser(fix === false ? o : reseal(o));
  rej('vacío', '', /vac/); rej('solo espacios', '   \n', /vac/); rej('no es JSON', 'esto no es json', /JSON/);
  rej('JSON truncado', PP.serialize(mk('fbd')).slice(0, 400), /JSON/); rej('un arreglo, no un proyecto', '[1,2,3]', /objeto/); rej('objeto ajeno', '{"hola":1}', /No es un proyecto/);
  rej('formato incorrecto', w(Object.assign(base(), { format: 'otra_cosa' })), /No es un proyecto/);
  rej('versión de formato más nueva', w(Object.assign(base(), { formatVersion: 2 })), /más nuevo/);
  rej('formatVersion 0', w(Object.assign(base(), { formatVersion: 0 })), /formatVersion/); rej('formatVersion texto', w(Object.assign(base(), { formatVersion: '1' })), /formatVersion/);
  rej('editor desconocido', w(Object.assign(base(), { editor: 'st' })), /editor/); rej('falta el diagrama', w((() => { const o = base(); delete o.diagram; return o; })()), /diagrama/);
  rej('destino distinto', w((() => { const o = base(); o.compat.target = 'OTRO'; return o; })()), /destino/);
  rej('demasiado grande', '{"a":"' + 'x'.repeat(PP.MAX_FILE_BYTES + 10) + '"}', /demasiado grande/);
  rej('demasiado grande (límite configurable)', PP.serialize(mk('fbd')), /demasiado grande/, { maxBytes: 100 });
  rej('FBD sin nodos', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data = {}; o.ir = null; return o; })()), /vac/);
  rej('FBD con más de 64 nodos', w((() => { const o = base(); const d = o.diagram.fbd.drawflow.Home.data; for (let i = 10; i < 80; i++) d[i] = JSON.parse(JSON.stringify(d['1'])), d[i].id = i; o.ir = null; return o; })()), /máximo 64/);
  rej('tipo de nodo desconocido', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].name = 'evil'; return o; })()), /tipo desconocido/);
  rej('conexión a un nodo inexistente', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].outputs.output_1.connections.push({ node: '77', output: 'input_1' }); return o; })()), /inexistente/);
  rej('typenode activo (Drawflow podría montar componentes)', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].typenode = 'vue'; return o; })()), /typenode/);
  rej('clase con comillas/atributos', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].class = 'a" onmouseover="x'; return o; })()), /class/);
  rej('id que no coincide con la clave', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].id = 5; return o; })()), /id no coincide/);
  rej('data con objetos anidados', w((() => { const o = base(); o.diagram.fbd.drawflow.Home.data['1'].data = { a: { b: 1 } }; return o; })()), /valor de datos/);
  rej('prototipo contaminado (__proto__)', PP.serialize(mk('fbd')).replace('"project":{', '"project":{"__proto__":{"polluted":1},'), /no permitida/);
  rej('clave constructor', PP.serialize(mk('fbd')).replace('"project":{', '"project":{"constructor":{"x":1},'), /no permitida/);
  check('B6b Object.prototype no fue contaminado por los archivos hostiles', ({}).polluted === undefined && ({}).x === undefined);
  rej('Ladder sin renglones', w((() => { const o = baseL(); o.diagram.ladder.rungs = []; o.ir = null; return o; })()), /sin renglones|no tiene renglones/);
  rej('Ladder con más de 128 renglones', w((() => { const o = baseL(); o.diagram.ladder.rungs = Array.from({ length: 129 }, () => ladProg().rungs[0]); o.ir = null; return o; })()), /128/);
  rej('Ladder con variable maliciosa', w((() => { const o = baseL(); o.diagram.ladder.rungs[0].paths[0][0].var = '<img src=x onerror=alert(1)>'; return o; })()), /inválido/);
  rej('Ladder con formato más nuevo que el editor', w((() => { const o = baseL(); o.diagram.ladder.formatVersion = 9; return o; })()), /más nuevo/, { ladderAst: { FORMAT_VERSION: 4 } });
  rej('Ladder con campo de nombre raro', w((() => { const o = baseL(); o.diagram.ladder.rungs[0]['a b'] = 1; return o; })()), /nombre de campo/);
  rej('anidamiento excesivo', '{"format":"plc_project","formatVersion":1,"editor":"fbd","x":' + '['.repeat(60) + ']'.repeat(60) + '}', /anidamiento/);
  rej('IR con más de 64 nodos', w((() => { const o = base(); o.ir = { program: { nodes: Array.from({ length: 70 }, (_, i) => ({ id: i })) } }; return o; })()), /IR tiene 70/);
}
{
  // lista blanca de html de nodo
  const ok = ['<div>IN1</div>', '', '<div><div class="title-box">TON</div>T:<input type="number" df-time value="500" style="width:55px"> ms</div>',
    '<div>CMP<br><select df-op style="width:50px"><option value=">" selected>&gt;</option><option value="<"><</option></select></div>'];
  const bad = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<div onclick="x()">a</div>', '<a href="javascript:alert(1)">x</a>', '<iframe src="x"></iframe>', '<div style="background:url(javascript:x)">a</div>',
    '<input type="text" df-x>', '<div class="a"onmouseover=x>', '<div><svg onload=x></svg></div>', '<style>*{}</style>', '<div srcdoc="x">a</div>', '<!-- c --><div>a</div>', '<div ONCLICK="x">a</div>', '<div  data-x="1">a</div>', '<object data=x></object>'];
  check('B7 el html de nodo aceptado es solo el que producen los editores', ok.every(h => PP.safeNodeHtml(h).ok), ok.filter(h => !PP.safeNodeHtml(h).ok).join(' | '));
  const acc = bad.filter(h => PP.safeNodeHtml(h).ok);
  check('B8 html con script, img, on*, href, iframe, svg, style, url() o atributos no previstos se rechaza', acc.length === 0, 'ACEPTADOS: ' + acc.join(' | '));
}
{
  const lad = { format: 'ladder-pro', version: 4, source: 'ladder', rungs: ladProg().rungs };
  const a = PP.parse(JSON.stringify(lad)), b = PP.parse(JSON.stringify({ format: 'plc_program', version: 3, source: 'ladder', ladder: ladProg(), ir: null }));
  check('B9 JSON Ladder anterior ("ladder-pro") y envelope Ladder guardado en el PLC se aceptan como Ladder, con advertencia', a.ok && a.project.editor === 'ladder' && a.legacy && a.warnings.length && b.ok && b.project.editor === 'ladder', JSON.stringify(a.errors.concat(b.errors)));
  const c = PP.parse(JSON.stringify({ format: 'plc_program', version: 2, fbd: fbdProg(), drawflow: fbdProg().drawflow, ir: null }));
  check('B10 envelope FBD guardado en el PLC se acepta como FBD', c.ok && c.project.editor === 'fbd' && c.legacy, JSON.stringify(c.errors));
  check('B11 nombres: se sanean y el archivo es seguro', PP.sanitizeName('  <b>Tanque</b> / "1"  ') === 'b Tanque b 1' && PP.fileNameFor('Control Tanque ñandú') === 'Control_Tanque_nandu.plc' &&
    PP.fileNameFor('../../etc/passwd') === 'etc_passwd.plc' && PP.fileNameFor('') === 'Proyecto.plc' && PP.fileNameFor('x'.repeat(200)).length <= 44 && PP.sanitizeName('x'.repeat(200)).length <= 48);
}

// B12 — corpus real: los programas de los ejemplos del manual (los escriben tests/manual/*.js en /tmp), como FBD y convertidos a Ladder, no sufren falsos rechazos
{
  const tmp = require('os').tmpdir(); const cf = fs.readdirSync(tmp).filter(x => /^c_.*\.json$/.test(x));
  if (!cf.length) console.log('INFO B12 omitido: no hay corpus de /tmp/c_*.json (corre después de tests/manual/*)');
  else {
    global.window = global; global.PlcSymbolTable = require('../js/compiler/symbol_table.js');
    const C = require('../js/compiler/compiler.js'), DEC = require('../js/compiler/ladder_decompiler.js'), IC = require('../js/compiler/ir_check.js');
    const log = console.warn; console.warn = () => {}; const lg = console.log; 
    let nf = 0, okf = 0, nl = 0, okl = 0, firstBad = '';
    for (const f of cf) for (const it of JSON.parse(rd(path.join(tmp, f)))) {
      const prog = it.prog || it; if (!prog || !prog.drawflow) continue;
      nf++; const rf = PP.parse(PP.serialize(PP.build({ name: 'c', editor: 'fbd', fbd: prog }))); if (rf.ok) okf++; else firstBad = firstBad || ('FBD ' + rf.errors[0]);
      try {
        const ir = C.compileProject(prog, 'fbd'); const cv = DEC.convertIRToLadder(ir, { compile: C.compileLadder, check: IC });
        if (cv.ok) { nl++; const rl = PP.parse(PP.serialize(PP.build({ name: 'c', editor: 'ladder', ladder: { formatVersion: 4, rungs: cv.rungs } })), {}); if (rl.ok) okl++; else firstBad = firstBad || ('LAD ' + rl.errors[0]); }
      } catch (e) {}
    }
    console.warn = log;
    check(`B12 corpus real del manual: ${okf}/${nf} programas FBD y ${okl}/${nl} programas Ladder convertidos se exportan e importan sin falsos rechazos`, nf >= 30 && okf === nf && nl >= 30 && okl === nl, firstBad);
  }
}

// ───────── C. Páginas reales (jsdom): FBD/Ladder × simulador/ESP ─────────
const snap = S => S.w.editor ? JSON.stringify(S.w.editor.export().drawflow) : JSON.stringify(S.w.rungs.map(r => ({ p: r.paths, o: r.outputs, c: r.comment, k: r.kind, ch: r.chain })));
const normRungs = w => JSON.stringify(w.rungs.map(r => ({ p: r.paths, o: r.outputs, c: r.comment || '', k: r.kind || null, ch: r.chain || null })));
(async () => {
  // C0 — el html que producen los editores REALES (los 24 tipos de nodo) y el que genera irToDrawflow pasa la lista blanca
  {
    const S = await bootPage('program.html', 'esp'); const w = S.w;
    const adders = ['addInput1', 'addInput2', 'addOutput1', 'addOutput2', 'addOutput3', 'addOutput4', 'addAnalog1', 'addPWM', 'addAND', 'addOR', 'addNOT', 'addXOR', 'addCmp',
      'addTON', 'addTOF', 'addTP', 'addBlink', 'addCTU', 'addCTD', 'addSR', 'addRS', 'addRTrig', 'addFTrig', 'addScale'];
    adders.forEach(f => w[f]());
    const exp = w.editor.export(); const names = Object.values(exp.drawflow.Home.data).map(n => n.name);
    const r = PP.parse(PP.serialize(PP.build({ name: 'todos', editor: 'fbd', fbd: exp })));
    check('C0.1 los 24 tipos de nodo creados por los botones reales del editor FBD se exportan e importan (lista blanca de html sin falsos rechazos)', r.ok && names.length === 24 && new Set(names).size === 24 && PP.FBD_TYPES.every(t => names.includes(t)), (r.errors || []).join('|') + ' n=' + names.length);
    // html que genera el compilador para vistas de programas Ladder en el editor FBD (irToDrawflow)
    const fake = PP.FBD_TYPES.map((t, i) => ({ id: i + 1, type: t, in1: null, in2: null, outputs: [], preset: 5, value: 7, op: '>=', outIdx: 0, pv: 3, inMin: 0, inMax: 4095, outMin: 0, outMax: 100 }));
    let bad = [];
    try { const df = w.PlcCompiler.irToDrawflow(fake); Object.values(df.drawflow.Home.data).forEach(n => { const h = PP.safeNodeHtml(n.html); if (!h.ok) bad.push(n.name + ': ' + h.why); }); } catch (e) { bad.push('irToDrawflow: ' + e.message); }
    check('C0.2 el html de irToDrawflow (programa Ladder visto en FBD y luego exportado) también pasa la lista blanca', bad.length === 0, bad.join(' | '));
    w.close();
  }

  // C1 — FBD: crear → exportar → (otra sesión/otro destino) importar → mismo diagrama, misma compilación
  for (const [kindA, kindB] of [['esp', 'esp'], ['sim', 'esp'], ['esp', 'sim'], ['sim', 'sim']]) {
    const tag = `${kindA === 'sim' ? 'simulador' : 'ESP'} → ${kindB === 'sim' ? 'simulador' : 'ESP'}`;
    const A = await bootPage('program.html', kindA); buildTankFbd(A.w, 100); await tick(100);
    const before = snap(A), bA = A.w.buildFbdEnvelope();
    const text = A.w.exportProject(); const dl = A.w.__dl;
    check(`C1 FBD ${tag}: Exportar genera ${dl && dl.name} con el proyecto completo`, bA.ok && !!text && dl && dl.name === 'Proyecto_FBD.plc' && dl.text === text && A.saves() === 0, A.errs.join('|') + (dl ? '' : ' sin descarga'));
    A.w.close();
    const B = await bootPage('program.html', kindB, kindB === 'esp' ? { espOpts: { program: JSON.stringify({ marker: 'programa-anterior-en-el-PLC', format: 'plc_program', version: 2, fbd: JSON.parse(JSON.stringify(program([{ id: 1, name: 'input1' }, { id: 2, name: 'output1' }], [[1, 2]]))), ir: null }) } } : undefined);
    const prevSaved = B.saved();
    const ok = await B.w.importProjectText(text, 'x.plc');
    const bB = B.w.buildFbdEnvelope();
    check(`C1 FBD ${tag}: Importar reconstruye el diagrama IDÉNTICO (nodos, nombres, conexiones, parámetros, posiciones)`, ok === true && snap(B) === before, 'import=' + ok + ' ' + B.msg().slice(0, 120));
    check(`C1 FBD ${tag}: compilación equivalente antes y después (mismo IR, nodo por nodo)`, bB.ok && PP.irKey(bA.ir) === PP.irKey(bB.ir) && /coincide/.test(B.msg()), B.msg().slice(0, 160));
    check(`C1 FBD ${tag}: importar NO guardó nada en el PLC (0 /save, programa anterior intacto) y avisa que falta Guardar`, B.saves() === 0 && B.saved() === prevSaved && /NO está guardado/.test(B.msg()) && !!B.w.__projImportPending, `saves=${B.saves()}`);
    // Guardar en PLC: pide confirmación; si se rechaza no guarda; si se acepta guarda
    B.w.__confirmAns = false; B.w.__confirms.length = 0; B.w.saveProgram(); await tick(200);
    check(`C1 FBD ${tag}: Guardar tras importar PIDE confirmación; si se rechaza, el PLC queda intacto`, B.w.__confirms.length === 1 && /REEMPLAZAR/.test(B.w.__confirms[0]) && B.saves() === 0 && B.saved() === prevSaved && /cancelado/.test(B.msg()), B.w.__confirms.join('|').slice(0, 100));
    B.w.__confirmAns = true; B.w.saveProgram(); await tick(300);
    const env = B.saved() && JSON.parse(B.saved());
    check(`C1 FBD ${tag}: confirmado, se guarda (1 /save) y ${kindB === 'sim' ? 'el mensaje aclara que es el PLC SIMULADO (no hardware)' : 'el mensaje dice que se guardó en el PLC'}`,
      B.saves() === 1 && env && env.format === 'plc_program' && !B.w.__projImportPending && (kindB === 'sim' ? /SIMULADO.*no se guard[oó] en ning[uú]n hardware/.test(B.msg()) : /guardado en el PLC/.test(B.msg()) && !/SIMULADO/.test(B.msg())), B.msg().slice(0, 140));
    if (hasHost && env) {
      const fw = out4(runFirmware(env, TANK_STEPS)), sm = out4(runSim(env, TANK_STEPS));
      check(`C1 FBD ${tag}: el programa importado y guardado corre igual en el firmware real y en el simulador (tanque)`, fw === '1000,1100,1100,0000' && sm === fw, fw + ' / ' + sm);
    }
    check(`C1 FBD ${tag}: sin errores de script`, B.errs.length === 0, B.errs.join('|'));
    B.w.close();
  }

  // C2 — Ladder
  for (const [kindA, kindB] of [['esp', 'esp'], ['sim', 'esp'], ['esp', 'sim'], ['sim', 'sim']]) {
    const tag = `${kindA === 'sim' ? 'simulador' : 'ESP'} → ${kindB === 'sim' ? 'simulador' : 'ESP'}`;
    const A = await bootPage('ladder.html', kindA); buildTankLadder(A.w); await tick(100);
    const before = normRungs(A.w), bA = A.w.buildLadderEnvelope();
    const text = A.w.exportProject(); const dl = A.w.__dl;
    check(`C2 Ladder ${tag}: Exportar genera ${dl && dl.name}`, bA.ok && !!text && dl && dl.name === 'Proyecto_Ladder.plc' && A.saves() === 0, A.errs.join('|'));
    A.w.close();
    const B = await bootPage('ladder.html', kindB, kindB === 'esp' ? { espOpts: { program: '{"marker":"programa-anterior","format":"plc_program","version":3,"source":"ladder"}' } } : undefined);
    const prevSaved = B.saved();
    const ok = await B.w.importProjectText(text, 'x.plc'); const bB = B.w.buildLadderEnvelope();
    check(`C2 Ladder ${tag}: Importar reconstruye los renglones idénticos (contactos, bobinas, direcciones, comentarios)`, ok === true && normRungs(B.w) === before && B.w.rungs.length === 3, B.msg().slice(0, 140));
    check(`C2 Ladder ${tag}: compilación equivalente antes y después`, bB.ok && PP.irKey(bA.ir) === PP.irKey(bB.ir) && /coincide/.test(B.msg()), B.msg().slice(0, 160));
    check(`C2 Ladder ${tag}: importar NO guardó nada en el PLC (0 /save, programa anterior intacto)`, B.saves() === 0 && B.saved() === prevSaved && !!B.w.__projImportPending, `saves=${B.saves()}`);
    B.w.__confirmAns = false; B.w.__confirms.length = 0; B.w.compileAndSend(); await tick(200);
    check(`C2 Ladder ${tag}: Guardar tras importar pide confirmación; rechazada → PLC intacto`, B.w.__confirms.length === 1 && /REEMPLAZAR/.test(B.w.__confirms[0]) && B.saves() === 0 && B.saved() === prevSaved);
    B.w.__confirmAns = true; B.w.compileAndSend(); await tick(300);
    const env = B.saved() && JSON.parse(B.saved());
    check(`C2 Ladder ${tag}: confirmado, se guarda (1 /save); ${kindB === 'sim' ? 'mensaje del PLC SIMULADO' : 'mensaje de guardado en el PLC'}`,
      B.saves() === 1 && env && env.source === 'ladder' && env.ladder.formatVersion === 4 && !B.w.__projImportPending && (kindB === 'sim' ? /SIMULADO/.test(B.msg()) : /guardado en el PLC/.test(B.msg())), B.msg().slice(0, 140));
    if (hasHost && env) {
      const fw = out4(runFirmware(env, TANK_STEPS)), sm = out4(runSim(env, TANK_STEPS));
      check(`C2 Ladder ${tag}: el programa importado corre igual en el firmware real y en el simulador`, fw === '1100,1100,1100,0000' && sm === fw, fw + ' / ' + sm);
    }
    B.w.close();
  }

  // C3 — botones: el simulador no finge hardware
  {
    const S = await bootPage('program.html', 'sim'), E = await bootPage('program.html', 'esp'), SL = await bootPage('ladder.html', 'sim'), EL = await bootPage('ladder.html', 'esp');
    const t = p => p.w.document.getElementById('btn-save-plc').textContent;
    check('C3 en el simulador el botón dice «Guardar en PLC (simulado)»; en el ESP, «Guardar en PLC» (FBD y Ladder)', /simulado/.test(t(S)) && /simulado/.test(t(SL)) && /Guardar en PLC/.test(t(E)) && !/simulado/.test(t(E)) && /Guardar en PLC/.test(t(EL)) && !/simulado/.test(t(EL)), [t(S), t(SL), t(E), t(EL)].join(' | '));
    [S, E, SL, EL].forEach(p => p.w.close());
  }

  // C4 — cruce de editores
  {
    const A = await bootPage('program.html', 'esp'); buildTankFbd(A.w, 100); await tick(100); const fbdText = A.w.exportProject(); A.w.close();
    const Lp = await bootPage('ladder.html', 'esp'); buildTankLadder(Lp.w); await tick(100); const ladText = Lp.w.exportProject(); Lp.w.close();
    // FBD .plc → editor Ladder: se convierte (como el FBD guardado en el PLC), sin tocar el PLC
    const B = await bootPage('ladder.html', 'esp'); const prev = B.saved();
    const ok = await B.w.importProjectText(fbdText, 'tanque.plc');
    check('C4.1 un .plc FBD convertible se abre en Ladder (conversión verificada) y no toca el PLC', ok === true && B.w.rungs.length >= 1 && /convertido a Ladder/.test(B.msg()) && B.saves() === 0 && B.saved() === prev, B.msg().slice(0, 160));
    B.w.close();
    // FBD .plc no convertible (2 memorias en lazo) → Ladder lo rechaza y conserva el editor
    const loop = (() => { const p = program([{ id: 1, name: 'input1' }, { id: 2, name: 'input2' }, { id: 3, name: 'sr' }, { id: 4, name: 'rs' }, { id: 5, name: 'output1' }], [[1, 3, 1], [4, 3, 2], [2, 4, 1], [3, 4, 2], [3, 5]]);
      const d = p.drawflow.Home.data; Object.values(d).forEach(n => { n.html = '<div>' + n.name + '</div>'; }); return p; })();
    const loopText = PP.serialize(PP.build({ name: 'Lazo', editor: 'fbd', fbd: loop }));
    const C = await bootPage('ladder.html', 'esp'); buildTankLadder(C.w); await tick(50); const keep = normRungs(C.w);
    const ok2 = await C.w.importProjectText(loopText, 'lazo.plc');
    check('C4.2 un .plc FBD NO convertible se rechaza con motivos; el Ladder abierto y el PLC quedan intactos', ok2 === false && normRungs(C.w) === keep && C.saves() === 0 && /no se puede convertir/.test(C.msg()), C.msg().slice(0, 160));
    C.w.close();
    // Ladder .plc → editor FBD: no se puede abrir ahí; se rechaza sin cambios
    const F = await bootPage('program.html', 'esp'); buildTankFbd(F.w, 100); await tick(50); const keepF = snap(F);
    const ok3 = await F.w.importProjectText(ladText, 'l.plc');
    check('C4.3 un .plc Ladder abierto en FBD se rechaza con aviso (usar el editor Ladder); FBD y PLC intactos', ok3 === false && snap(F) === keepF && F.saves() === 0 && /Ladder/.test(F.msg()), F.msg().slice(0, 160));
    F.w.close();
  }

  // C5 — archivos corruptos/incompatibles/enormes por la interfaz real; el editor y el PLC no cambian
  {
    const A = await bootPage('program.html', 'esp'); buildTankFbd(A.w, 100); await tick(100); const goodText = A.w.exportProject(); A.w.close();
    const B = await bootPage('program.html', 'esp', { espOpts: { program: '{"marker":"anterior","format":"plc_program","version":2}' } }); buildTankFbd(B.w, 100); await tick(100);
    const keep = snap(B), prev = B.saved(); const mkInp = (txt, name) => ({ files: [new B.w.File([txt], name || 'x.plc')], value: 'x' });
    const cases = [
      ['archivo truncado', goodText.slice(0, 700)], ['no es JSON', 'hola mundo'], ['vacío', ''], ['formato futuro', goodText.replace('"formatVersion":1', '"formatVersion":9')],
      ['suma alterada', goodText.replace('"pos_x":', '"pos_x":1')], ['demasiado grande', '{"x":"' + 'a'.repeat(PP.MAX_FILE_BYTES) + '"}'],
      ['html hostil en un nodo', (() => { const o = JSON.parse(goodText); o.diagram.fbd.drawflow.Home.data['1'].html = '<img src=x onerror="window.__pwn=1">'; return JSON.stringify(reseal(o)); })()]];
    for (const [nm, txt] of cases) {
      B.w.__confirms.length = 0;
      const r = await B.w.importProject(mkInp(txt));
      check(`C5 «${nm}»: rechazado, editor sin cambios, 0 /save, programa del PLC intacto, sin confirmación pedida`, r === false && snap(B) === keep && B.saves() === 0 && B.saved() === prev && B.w.__confirms.length === 0 && /sigue(n)? sin cambios/.test(B.msg()) && !B.w.__projImportPending, B.msg().slice(0, 120));
    }
    check('C5 el html hostil no se ejecutó (window.__pwn indefinido)', B.w.__pwn === undefined);
    // el usuario cancela la importación válida
    B.w.__confirmAns = false; const rc = await B.w.importProject(mkInp(goodText));
    check('C5 si el usuario cancela la confirmación de importar, nada cambia', rc === false && snap(B) === keep && B.saves() === 0 && !B.w.__projImportPending && /cancelada/.test(B.msg()));
    check('C5 sin errores de script durante todo el bloque', B.errs.length === 0, B.errs.join('|'));
    B.w.close();
  }

  // C6 — Ladder: JSON anterior sigue funcionando y .plc hostil
  {
    const A = await bootPage('ladder.html', 'esp'); buildTankLadder(A.w); await tick(100);
    const json = A.w.exportJSON();                                                       // formato anterior (ladder-pro)
    const B = await bootPage('ladder.html', 'esp');
    B.w.importJSON({ files: [new B.w.File([json], 'ladder_program.json')], value: '' }); await tick(300);
    check('C6.1 el export/import JSON Ladder anterior sigue funcionando (3 renglones)', B.w.rungs.length === 3 && normRungs(B.w) === normRungs(A.w) && B.saves() === 0);
    const C = await bootPage('ladder.html', 'esp'); const okL = await C.w.importProjectText(json, 'ladder_program.json');
    check('C6.2 el JSON Ladder anterior también entra por «Importar proyecto» (con advertencia) y exige confirmar el guardado', okL === true && C.w.rungs.length === 3 && /formato anterior/.test(C.msg()) && C.saves() === 0 && !!C.w.__projImportPending, C.msg().slice(0, 140));
    const o = JSON.parse(PP.serialize(PP.build({ name: 'X', editor: 'ladder', ladder: JSON.parse(JSON.stringify({ formatVersion: 4, rungs: A.w.rungs.map(r => ({ id: r.id, comment: '<img src=x onerror="window.__pwn2=1">', paths: r.paths, outputs: r.outputs })) })) })));
    const D2 = await bootPage('ladder.html', 'esp'); const okC = await D2.w.importProjectText(JSON.stringify(o), 'c.plc');
    const imgs = D2.w.document.querySelectorAll('img').length;
    check('C6.3 comentarios con HTML se importan como texto: no se crea ningún <img> ni se ejecuta código', okC === true && D2.w.__pwn2 === undefined && imgs === 0, `img=${imgs} ok=${okC}`);
    [A, B, C, D2].forEach(p => p.w.close());
  }

  // C7 — descarga real (Blob + <a download>) y lectura de archivo real
  {
    const S = await bootPage('program.html', 'esp'); const w = S.w;
    let clicked = null; w.HTMLAnchorElement.prototype.click = function () { clicked = { download: this.download, href: this.href }; };
    const PPb = w.__realProject;   // funciones reales de la página (download usa Blob/URL/document de la ventana)
    const blob = PPb.download('Control_Tanque.plc', '{"a":1}');
    check('C7.1 Exportar crea un Blob JSON y dispara una descarga con extensión .plc (sin red)', clicked && clicked.download === 'Control_Tanque.plc' && clicked.href === 'blob:test' && blob.type === 'application/json' && blob.size === 7, JSON.stringify(clicked));
    let msg = ''; await PPb.readFile(new w.File(['x'.repeat(PP.MAX_FILE_BYTES + 1)], 'big.plc')).catch(e => { msg = e.message; });
    check('C7.2 un archivo demasiado grande se rechaza ANTES de leerlo', /demasiado grande/.test(msg), msg);
    const txt = await PPb.readFile(new w.File(['{"ok":1}'], 'a.plc'));
    check('C7.3 un archivo normal se lee como texto', txt === '{"ok":1}');
    w.close();
  }

  // C8 — ejemplos del repositorio: se abren en el editor correspondiente, compilan y funcionan
  {
    const fx = rd(path.join(EX, 'Control_Tanque_FBD.plc')), lx = rd(path.join(EX, 'Control_Tanque_Ladder.plc'));
    for (const kind of ['sim', 'esp']) {
      const F = await bootPage('program.html', kind); const okF = await F.w.importProjectText(fx, 'Control_Tanque_FBD.plc'); const bF = F.w.buildFbdEnvelope();
      const L2 = await bootPage('ladder.html', kind); const okL = await L2.w.importProjectText(lx, 'Control_Tanque_Ladder.plc'); const bL = L2.w.buildLadderEnvelope();
      check(`C8 ejemplos (${kind}): el FBD y el Ladder se importan, compilan y su IR coincide con el del archivo`, okF && okL && bF.ok && bL.ok && /coincide/.test(F.msg()) && /coincide/.test(L2.msg()) && F.saves() === 0 && L2.saves() === 0, F.msg().slice(0, 80) + ' | ' + L2.msg().slice(0, 80));
      if (hasHost && bF.ok && bL.ok) {
        const a = out4(runFirmware(bF.envelope, TANK_STEPS)), b = out4(runFirmware(bL.envelope, TANK_STEPS));
        check(`C8 ejemplos (${kind}): corren en el firmware real (FBD y Ladder)`, a === '1000,1100,1100,0000' && b === '1100,1100,1100,0000', a + ' / ' + b);
      }
      F.w.close(); L2.w.close();
    }
  }

  // C9 — E6/E7: guardar sin importar sigue sin pedir confirmación y sigue siendo el mismo envelope
  {
    const S = await bootPage('program.html', 'esp'); buildTankFbd(S.w, 100); await tick(100); S.w.saveProgram(); await tick(300);
    check('C9.1 FBD: «Guardar en PLC» normal (sin importar) guarda sin pedir confirmación, envelope plc_program v2 con drawflow de nivel superior',
      S.saves() === 1 && S.w.__confirms.length === 0 && JSON.parse(S.saved()).version === 2 && !!JSON.parse(S.saved()).drawflow);
    S.w.close();
    const T = await bootPage('ladder.html', 'esp'); buildTankLadder(T.w); await tick(100); T.w.compileAndSend(); await tick(300);
    check('C9.2 Ladder: «Guardar en PLC» normal guarda sin confirmación, envelope Ladder v4', T.saves() === 1 && T.w.__confirms.length === 0 && JSON.parse(T.saved()).ladder.formatVersion === 4);
    T.w.close();
  }

  const s = H.summary(); console.log(`E7 portable: PASS ${s.pass} FAIL ${s.fail}`); process.exit(s.fail ? 1 : 0);
})().catch(e => { console.log('FAIL excepción: ' + e.stack); process.exit(1); });
