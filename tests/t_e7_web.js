'use strict';
// E7 — Interfaz web embebida (firmware/data): recursos, dependencias, rutas, sin Internet, integración FBD/Ladder contra un
// ESP32 simulado a nivel HTTP (esp_mock.js, con las respuestas del firmware) y ejecución del programa guardado en el firmware real compilado en el host.
// NO prueba el ESP32 físico (SPIFFS, WiFi, WebServer reales): ver docs/Checklist_servidor_embebido.md.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..'), D = path.join(R, 'firmware', 'data');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || (fs.existsSync(__dirname + '/node_modules/jsdom') ? __dirname + '/node_modules/jsdom' : '/tmp/jsd/node_modules/jsdom'));
const H = require('./harness'); const { check, program, runFirmware } = H;
const { mkEsp } = require('./esp_mock');
const tick = ms => new Promise(r => setTimeout(r, ms || 50));
const rd = f => fs.readFileSync(path.join(D, f), 'utf8');
const files = fs.readdirSync(D);

// ───────── A. Estático ─────────
const b = spawnSync('node', [path.join(R, 'tools/build_web.js'), '--check'], { encoding: 'utf8' });
check('A1 firmware/data coincide con lo que genera tools/build_web.js (reproducible)', b.status === 0, (b.stdout + b.stderr).trim().slice(0, 200));
const PAGES = ['index.html', 'program.html', 'ladder.html', 'monitor.html', 'manual.html', 'about.html'];
const NEED = [...PAGES, 'style.css', 'drawflow.min.js', 'drawflow.min.css', 'editor.js', 'plc_api.js', 'plc_api_esp.js', 'compiler.js', 'symbol_table.js',
  'ladder_ast.js', 'ladder_program.js', 'ladder_decompiler.js', 'ir_check.js', 'memory_panel.js', 'LICENSE.txt'];
check('A2 están todos los recursos necesarios para FBD, Ladder, monitor, manual', NEED.every(f => files.includes(f)), NEED.filter(f => !files.includes(f)).join(','));
const long = files.filter(f => ('/' + f).length > 31);
check('A3 todos los nombres entran en SPIFFS (≤ 31 caracteres con "/")', long.length === 0, long.join(','));
check('A4 sin subdirectorios (SPIFFS es plano)', files.every(f => fs.statSync(path.join(D, f)).isFile()));
const localRef = u => u && !/^(https?:|mailto:|data:|javascript:|#|\/\/|\/)/.test(u);
let broken = [], sim = [], ext = [];
for (const f of files.filter(x => /\.(html|css|js)$/.test(x))) {
  let t = rd(f);
  if (f !== 'drawflow.min.js') {
    if (f !== 'plc_api_esp.js' && /\bSimState\b|plc_sim_|simulator\//.test(t)) sim.push(f);
  }
  if (/\.html$/.test(f)) {
    const tt = t.replace(/data:[^"')]+/g, '');
    for (const m of tt.matchAll(/\b(?:src|href)="([^"#?]+)/g)) {
      if (localRef(m[1]) && !files.includes(m[1])) broken.push(f + ' -> ' + m[1]);
      if (/^https?:/.test(m[1]) && /\.(css|js)(\?|$)/.test(m[1])) ext.push(f + ' -> ' + m[1]);
      if (/^https?:|^\/\//.test(m[1]) && !/\/\/(www\.)?(github\.com)/.test(m[1])) ext.push(f + ' -> ' + m[1]);
    }
  }
  const tt2 = t.replace(/data:[^"')]+/g, '');
  for (const m of tt2.matchAll(/@import\s+url\(\s*['"]?(https?:[^'")]+)/g)) ext.push(f + ' @import ' + m[1]);
  for (const m of tt2.matchAll(/url\(\s*['"]?(https?:[^'")]+)/g)) ext.push(f + ' url() ' + m[1]);
  if (f !== 'drawflow.min.js') for (const m of tt2.matchAll(/(?:fetch|\.open)\(\s*(?:['"]GET['"]\s*,\s*)?['"`](https?:[^'"`]+)/g)) ext.push(f + ' fetch ' + m[1]);
}
check('A5 referencias locales de todas las páginas resueltas dentro de firmware/data', broken.length === 0, broken.join('; '));
check('A6 el simulador NO está en la interfaz embebida (interceptaría fetch)', sim.length === 0 && !files.some(f => /^plc_sim|sim_panel/.test(f)), sim.join(','));
check('A7 ninguna dependencia obligatoria de Internet (scripts, CSS, fuentes, fetch)', ext.length === 0, ext.join('; '));
// rutas HTTP vs firmware
const ino = fs.readFileSync(path.join(R, 'firmware/PLC_CORE_MDE.ino'), 'utf8');
const routes = new Set([...ino.matchAll(/server\.on\("([^"]+)"/g)].map(m => m[1]));
const used = new Map();
for (const f of files.filter(x => /\.(html|js)$/.test(x) && x !== 'drawflow.min.js'))
  for (const m of rd(f).replace(/data:[^"')]+/g, '').matchAll(/(?:fetch|_get|_post)\(\s*['"`](\/[a-z_\/]+)/g)) { (used.get(m[1]) || used.set(m[1], []).get(m[1])).push(f); }
const missing = [...used].filter(([u]) => u !== '/' && !routes.has(u));
check('A8 toda ruta HTTP que usan las páginas existe en el firmware, salvo /api/memory (reemplazada por el adaptador)', missing.every(([u]) => u === '/api/memory'), missing.map(([u, f]) => u + ' en ' + [...new Set(f)]).join('; '));
const memUsers = [...(used.get('/api/memory') || [])];
check('A9 /api/memory solo aparece en plc_api.js (y el adaptador lo sustituye)', memUsers.every(f => f === 'plc_api.js') && rd('plc_api_esp.js').includes('Api.getMemory'), memUsers.join(','));
check('A10 el firmware sirve cualquier archivo de SPIFFS (handleNotFound→handleFile) e index por defecto', /handleNotFound[\s\S]{0,200}handleFile\(server\.uri\(\)\)/.test(ino) && /path \+= "index\.html"/.test(ino));
// tamaño
const sizes = files.map(f => [f, fs.statSync(path.join(D, f)).size]); const total = sizes.reduce((a, [, s]) => a + s, 0);
const info = JSON.parse(rd('build_info.json'));
check('A11 tamaño total ≤ 1 MB y estimación SPIFFS ≤ 70 % de la partición por defecto (1.507.328 B)', total <= 1000000 && info.estimatedSpiffsBytes <= 0.7 * 1507328, `${total} B; estimado SPIFFS ${info.estimatedSpiffsBytes} B`);
const reserve = 1507328 - info.estimatedSpiffsBytes;
check('A12 queda espacio para guardar programas (≥ 2 × 80 KB: archivo + .tmp transaccional)', reserve >= 2 * 80 * 1024, `libre estimado ${reserve} B`);
check('A13 un solo motor: la interfaz embebida no trae otro runtime ni compilador duplicado', files.filter(f => /^compiler\.js$/.test(f)).length === 1 && !files.some(f => /runtime|plc_sim/.test(f)));

// ───────── B. Adaptador ─────────
{
  const w = {}; w.self = w; global.self = w; global.fetch = () => { throw new Error('no red'); };
  w.PlcApi = {}; new Function('self', 'module', rd('plc_api_esp.js') + ';')(w, undefined);   // sin plc_api: no hace nada
  w.PlcApi = require(path.join(R, 'js/api/plc_api.js')); new Function('self', rd('plc_api_esp.js'))(w);
  const m = w.PlcApi._espBuildMemory({ io: { in: [1, 0], ai: [1234], out: [1, 0, 0, 1] } }, { nodes: [
    { id: 3, name: 'ton', state: true, intValue: 0 }, { id: 5, name: 'ctu', state: true, intValue: 7 }, { id: 9, name: 'sr', state: true, intValue: 0 },
    { id: 40, name: 'analog1', state: false, intValue: 1500 }] });
  check('B1 adaptador: X/Y/A desde /status; T, C, R(=CV) y M con el mismo mapeo que el simulador', m.X[0] === 1 && m.X[1] === 0 && m.Y[0] === 1 && m.Y[3] === 1 && m.A[0] === 1500 && m.T[3] === 1 && m.C[5] === 1 && m.R[21] === 7 && m.M[9] === 1 && m.X.length === 64 && m.T.length === 32, JSON.stringify([m.X[0], m.Y[0], m.A[0], m.T[3], m.C[5], m.R[21], m.M[9]]));
  w.PlcApi.patchMemory({ X: [1] }).then(() => check('B2 forzar entradas físicas desde la web se rechaza', false), () => check('B2 forzar entradas físicas desde la web se rechaza', true));
}
// mapeo idéntico al simulador (leído del código real del simulador)
{
  const src = fs.readFileSync(path.join(R, 'simulator/plc_sim_runtime.js'), 'utf8');
  check('B3 el mapeo T/C/R/M del adaptador replica plc_sim_runtime.js (id % tamaño; CV en (id+16) % 32)', /nodes\[i\]\.id % MEM_T_SIZE/.test(src) && /nodes\[i\]\.id % MEM_C_SIZE/.test(src) && /\(nodes\[i\]\.id \+ 16\) % MEM_R_SIZE/.test(src) && /nodes\[i\]\.id % MEM_M_SIZE/.test(src));
}

// ───────── B'. Regresión E7: validación del IR (índices, no ids) ─────────
{
  global.window = global; const ST = require(path.join(R, 'js/compiler/symbol_table.js'));
  const nodes = [{ id: 1, type: 'input1', in1: null, in2: null }, { id: 2, type: 'input2', in1: null, in2: null }, { id: 3, type: 'rs', in1: 0, in2: 3 }, { id: 4, type: 'not', in1: 1, in2: null }, { id: 5, type: 'output1', in1: 2, in2: null }];
  check('B4 RS id 3 con driver NOT id 4 (índice 3) ya no da SELF_LOOP falso', !ST.validate(nodes).errors.some(e => e.code === 'SELF_LOOP'), JSON.stringify(ST.validate(nodes).errors));
  const loop = [{ id: 1, type: 'input1', in1: null, in2: null }, { id: 2, type: 'and', in1: 1, in2: 0 }];
  check('B5 una autorreferencia real (índice propio) sí se detecta', ST.validate(loop).errors.some(e => e.code === 'SELF_LOOP'));
}

// ───────── C. Páginas en jsdom contra el ESP simulado ─────────
function boot(page, esp) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => errs.push(String(e.message || e).slice(0, 200)));
  return new Promise((resolve, reject) => {
    JSDOM.fromFile(path.join(D, page), { runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = esp.fetch; w.alert = m => { (w.__alerts = w.__alerts || []).push(String(m)); }; w.confirm = () => true;
        const mk = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, clear() {}, key: () => null, get length() { return 0; }, _m: m }; };
        Object.defineProperty(w, 'localStorage', { value: mk(), configurable: true }); Object.defineProperty(w, 'sessionStorage', { value: mk(), configurable: true });
      } }).then(dom => {
      const w = dom.window, t = setTimeout(() => reject(new Error('timeout ' + page)), 20000);
      w.addEventListener('load', () => setTimeout(() => { clearTimeout(t); resolve({ dom, w, errs }); }, 600));
    }).catch(reject);
  });
}
const out4 = o => o.filter(l => l.startsWith('OUT')).map(l => l.split(' ').slice(1, 5).join('')).join(',');
(async () => {
  // C1 páginas simples
  for (const pg of ['index.html', 'manual.html', 'about.html']) {
    const esp = mkEsp(); const S = await boot(pg, esp);
    check(`C1 ${pg} carga sin errores de script y sin simulador`, S.errs.length === 0 && typeof S.w.SimState === 'undefined', S.errs.join(' | '));
    S.w.close();
  }
  // C2 monitor
  {
    const esp = mkEsp(); esp.st.ins = [1, 0]; esp.st.ai = [2048]; esp.st.outs = [0, 1, 0, 0]; esp.st.wifi = true;
    esp.st.nodes = [{ id: 1, name: 'input1', state: true, intValue: 0, input1: -1, input2: -1, preset: 0, timerRunning: false }, { id: 2, name: 'output2', state: true, intValue: 0, input1: 0, input2: -1, preset: 0, timerRunning: false }];
    const S = await boot('monitor.html', esp); await tick(1500);
    const w = S.w, d = w.document;
    check('C2.1 monitor: sin errores de script', S.errs.length === 0, S.errs.join(' | '));
    check('C2.2 monitor: consulta /status y /nodes y NUNCA /api/memory', esp.st.log.includes('GET /status') && esp.st.log.includes('GET /nodes') && !esp.st.log.some(l => l.includes('/api/memory')), esp.st.log.slice(0, 8).join(','));
    check('C2.3 monitor: modo RUN y WiFi ON mostrados', /RUN/.test(d.getElementById('mode-badge').textContent) && /WIFI/.test(d.getElementById('wifi-badge').textContent) && d.getElementById('wifi-badge').className.includes('run'));
    check('C2.4 monitor: tabla de nodos con los 2 nodos del firmware', d.querySelectorAll('#node-tbody tr').length === 2, d.querySelectorAll('#node-tbody tr').length);
    d.getElementById('wifi-badge').click(); await tick(150);
    check('C2.5 monitor: el badge WiFi llama a /wifi/toggle (función de la interfaz anterior conservada)', esp.st.log.includes('GET /wifi/toggle') && /OFF/.test(d.getElementById('wifi-badge').textContent), d.getElementById('wifi-badge').textContent);
    w.close();
  }
  // C3 FBD: guardar -> firmware real -> cargar
  let fbdSaved;
  {
    const esp = mkEsp(); const S = await boot('program.html', esp); const w = S.w;
    check('C3.1 program.html: Drawflow, compilador y adaptador cargados; sin simulador', typeof w.Drawflow === 'function' && !!w.PlcCompiler && w.PlcApi.isEmbedded === true && S.errs.length === 0, S.errs.join(' | '));
    const prog = program([{ id: 1, name: 'input1' }, { id: 2, name: 'input2' }, { id: 3, name: 'rs' }, { id: 4, name: 'not' }, { id: 5, name: 'output1' }],
      [[1, 3, 1], [2, 4], [4, 3, 2], [3, 5]]);
    Object.values(prog.drawflow.Home.data).forEach(n => { n.html = '<div class="title-box">' + n.name + '</div>'; n.inputs = {}; n.outputs = { output_1: { connections: n.outputs.output_1.connections } }; });
    // Drawflow necesita inputs/outputs con puertos para importar
    const ins = { 3: 2, 5: 1, 4: 1 };
    Object.values(prog.drawflow.Home.data).forEach(n => { const k = ins[n.id] || 0; for (let i = 1; i <= k; i++) n.inputs['input_' + i] = { connections: [] }; });
    for (const n of Object.values(prog.drawflow.Home.data)) for (const c of n.outputs.output_1.connections) prog.drawflow.Home.data[c.node].inputs[c.output].connections.push({ node: String(n.id), input: 'output_1' });
    try { w.editor.import(prog); } catch (e) { check('C3.2 importar el diagrama en el editor', false, e.message); }
    await tick(100);
    if (process.env.DBG) console.log(JSON.stringify(w.editor.export().drawflow.Home.data['3']));
    w.saveProgram(); await tick(400);
    fbdSaved = esp.st.program;
    check('C3.2 FBD → /save → /plc/reload (1 guardado, 1 recarga, sin alertas de error)', esp.st.saves === 1 && esp.st.reloads === 1 && !(w.__alerts || []).length, `saves=${esp.st.saves} reloads=${esp.st.reloads} ${(w.__alerts || []).join('|')}`);
    const env = JSON.parse(fbdSaved);
    check('C3.3 envelope FBD: formato plc_program v2 con drawflow al nivel superior (lo que lee parseProgram)', env.format === 'plc_program' && env.version === 2 && !!env.drawflow && !!env.ir && Object.keys(env.drawflow.Home.data).length === 5);
    const st = [['in', 0, 1], ['in', 1, 1], ['scan', 3], ['print'], ['in', 1, 0], ['scan', 3], ['print'], ['in', 1, 1], ['scan', 2], ['print']];
    const o = runFirmware(env, st);
    check('C3.4 el envelope guardado desde la página corre en el firmware real: RS(S=IN1, R=NOT IN2), paro dominante', out4(o) === '1000,0000,1000', out4(o));
    // marcha/paro: IN2=1 (paro NC sin accionar) mantiene; IN2=0 (paro) apaga
    const o2 = runFirmware(env, [['in', 0, 1], ['in', 1, 1], ['scan', 3], ['print'], ['in', 0, 0], ['scan', 3], ['print'], ['in', 1, 0], ['scan', 3], ['print']]);
    check('C3.5 se mantiene al soltar el arranque y se apaga al abrir el paro NC', out4(o2) === '1000,1000,0000', out4(o2));
    w.close();
    // C4 recuperar: nueva sesión carga el programa guardado
    const esp2 = mkEsp({ program: fbdSaved }); const S2 = await boot('program.html', esp2);
    const n = Object.keys(S2.w.editor.export().drawflow.Home.data).length;
    check('C4.1 programa guardado se recupera al abrir el editor FBD (/load → 5 nodos)', n === 5 && esp2.st.log.includes('GET /load'), 'nodos=' + n);
    S2.w.close();
    // C4.2 formato antiguo (solo drawflow, como guardaba la UI anterior)
    const esp3 = mkEsp({ program: JSON.stringify({ drawflow: env.drawflow }) }); const S3 = await boot('program.html', esp3);
    check('C4.2 proyecto en formato antiguo (solo drawflow) también se abre', Object.keys(S3.w.editor.export().drawflow.Home.data).length === 5);
    S3.w.close();
  }
  // C5 Ladder: compilar → /save → firmware → recuperar
  let ladSaved;
  {
    const esp = mkEsp(); const S = await boot('ladder.html', esp); const w = S.w;
    check('C5.1 ladder.html carga sin errores ni simulador', S.errs.length === 0 && typeof w.SimState === 'undefined' && !!w.LadderAST, S.errs.join(' | '));
    const rid = w.rungs[0].id;
    const contact = (tool, r, pi, ci, addr) => { w.placeTool(tool, r, pi, ci); w.document.getElementById('mdl-addr').value = addr; w.confirmModal(); };
    contact('NO', rid, 0, 0, 'X0');                                                 // renglón 1: X0 -> SET Y0
    w.placeTool('SET', rid, 0, 0); w.document.getElementById('mdl-addr').value = 'Y0'; w.confirmModal();
    w.addRung(); const rid2 = w.rungs[1].id;                                        // renglón 2: X1 -> RESET Y0
    contact('NO', rid2, 0, 0, 'X1');
    w.placeTool('RESET', rid2, 0, 0); w.document.getElementById('mdl-addr').value = 'Y0'; w.confirmModal();
    await tick(50);
    w.compileAndSend(); await tick(500);
    ladSaved = esp.st.program;
    check('C5.2 Ladder → /save → /plc/reload', esp.st.saves === 1 && esp.st.reloads >= 1 && !!ladSaved, `saves=${esp.st.saves} reloads=${esp.st.reloads} alertas=${(w.__alerts || []).join('|')}`);
    const env = JSON.parse(ladSaved);
    check('C5.3 envelope Ladder v4 con drawflow para el runtime (mismo formato que FBD)', env.source === 'ladder' && env.ladder.formatVersion === 4 && !!env.drawflow && !!env.ir);
    const o = runFirmware(env, [['in', 0, 1], ['scan', 3], ['print'], ['in', 0, 0], ['scan', 3], ['print'], ['in', 1, 1], ['scan', 3], ['print']]);
    check('C5.4 Ladder guardado corre en el MISMO firmware: SET, retención y RESET', out4(o) === '1000,1000,0000', out4(o));
    w.close();
    const esp2 = mkEsp({ program: ladSaved }); const S2 = await boot('ladder.html', esp2);
    check('C5.5 el programa Ladder se recupera desde el ESP (/load) con sus renglones', S2.w.rungs.length === 2 && JSON.stringify(S2.w.rungs[0].paths).includes('"X0"') && esp2.st.log.includes('GET /load'), JSON.stringify(S2.w.rungs).slice(0, 100));
    S2.w.close();
  }
  // C6 FBD guardado por la UI FBD se abre en Ladder (convertible) y uno no convertible NO se sobrescribe
  {
    const env = JSON.parse(fbdSaved);
    const esp = mkEsp({ program: fbdSaved }); const S = await boot('ladder.html', esp);
    const ban = S.w.document.getElementById('conv-banner');
    check('C6.1 FBD (marcha/paro) guardado en el ESP se convierte a Ladder al abrir', S.w.rungs.length >= 1 && /correcta|verificada/.test(ban.textContent), ban.textContent.slice(0, 100));
    S.w.close();
    const loop = program([{ id: 1, name: 'input1' }, { id: 2, name: 'input2' }, { id: 3, name: 'sr' }, { id: 4, name: 'rs' }, { id: 5, name: 'output1' }],
      [[1, 3, 1], [4, 3, 2], [2, 4, 1], [3, 4, 2], [3, 5]]);
    const bad = JSON.stringify({ format: 'plc_program', version: 2, fbd: loop, drawflow: loop.drawflow });
    const e2 = mkEsp({ program: bad }); const S2 = await boot('ladder.html', e2);
    S2.w.compileAndSend(); await tick(300);
    check('C6.2 programa FBD no convertible (2 memorias en lazo): Ladder NO lo sobrescribe en el ESP', e2.st.saves === 0 && e2.st.program === bad, `saves=${e2.st.saves}`);
    S2.w.close();
  }
  const s = H.summary(); console.log(`E7 web: PASS ${s.pass} FAIL ${s.fail}`); process.exit(s.fail ? 1 : 0);
})().catch(e => { console.log('FAIL excepción: ' + e.stack); process.exit(1); });
