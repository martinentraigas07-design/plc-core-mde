'use strict';
// Utilidades compartidas por t_e7_portable.js y tools/make_examples.js: arranque de las páginas en jsdom
// (a) interfaz embebida de firmware/data contra un ESP32 simulado a nivel HTTP, o (b) páginas de la raíz con el simulador real,
// y constructores de los dos proyectos de ejemplo (Control de tanque, en FBD y en Ladder) usando las funciones REALES de los editores.
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..'), D = path.join(R, 'firmware', 'data');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || (fs.existsSync(__dirname + '/node_modules/jsdom') ? __dirname + '/node_modules/jsdom' : '/tmp/jsd/node_modules/jsdom'));
const { mkEsp } = require('./esp_mock');
const tick = ms => new Promise(r => setTimeout(r, ms || 50));
const mkStore = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, clear() {}, key: () => null, get length() { return 0; }, _m: m }; };

// kind: 'esp' → firmware/data + ESP simulado ; 'sim' → raíz + simulador real
function bootPage(page, kind, opts) {
  opts = opts || {};
  const esp = kind === 'esp' ? (opts.esp || mkEsp(opts.espOpts)) : null;
  const dir = kind === 'esp' ? D : R, errs = [], calls = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { const m = String(e.message || e); if (kind === 'sim' && /fonts\.googleapis\.com/.test(m)) return; errs.push(m.slice(0, 200)); });   // la raíz (simulador) pide Google Fonts: sin Internet cae a la fuente local
  return new Promise((resolve, reject) => {
    JSDOM.fromFile(path.join(dir, page), { runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, pretendToBeVisual: true,
      beforeParse(w) {
        w.__alerts = []; w.__confirms = []; w.__confirmAns = true;
        w.alert = m => { w.__alerts.push(String(m)); }; w.confirm = m => { w.__confirms.push(String(m)); return w.__confirmAns; };
        Object.defineProperty(w, 'localStorage', { value: mkStore(), configurable: true });
        Object.defineProperty(w, 'sessionStorage', { value: mkStore(), configurable: true });
        w.fetch = esp ? esp.fetch : () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve({}) });
        w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
      } }).then(dom => {
      const w = dom.window, t = setTimeout(() => reject(new Error('timeout ' + page)), 20000);
      w.addEventListener('load', () => setTimeout(() => {
        clearTimeout(t);
        const orig = w.fetch; w.fetch = function (u, o) { calls.push({ url: String(u).split('?')[0], method: (o && o.method) || 'GET' }); return orig.apply(w, arguments); };
        w.__realProject = Object.assign({}, w.PlcProject);
        w.PlcProject.download = (n, txt) => { w.__dl = { name: n, text: txt }; return null; };   // captura la descarga (la real se prueba aparte)
        resolve({ dom, w, errs, esp, kind, calls,
          saves: () => esp ? esp.st.saves : calls.filter(c => c.url === '/save' && c.method === 'POST').length,
          saved: () => esp ? esp.st.program : w.localStorage._m.plc_program,
          msg: () => (w.document.getElementById('proj-msg') || {}).textContent || '' });
      }, 600));
    }).catch(reject);
  });
}

// ── Ejemplo FBD: control de tanque. IN1=nivel bajo, IN2=nivel alto -> RS (reset dominante) -> OUT1 bomba; TON -> OUT2 aviso de bomba en marcha
function buildTankFbd(w, tonMs) {
  w.addInput1(); w.addInput2(); w.addRS(); w.addOutput1(); w.addTON(); w.addOutput2();      // ids 1..6
  const e = w.editor;
  e.addConnection(1, 3, 'output_1', 'input_1');   // nivel bajo  -> S
  e.addConnection(2, 3, 'output_1', 'input_2');   // nivel alto  -> R
  e.addConnection(3, 4, 'output_1', 'input_1');   // RS -> OUT1 (bomba)
  e.addConnection(3, 5, 'output_1', 'input_1');   // RS -> TON
  e.addConnection(5, 6, 'output_1', 'input_1');   // TON -> OUT2
  e.updateNodeDataFromId(5, { time: tonMs || 100 });
}
// ── Ejemplo Ladder: X0 (nivel bajo) SET Y0 ; X1 (nivel alto) RESET Y0 ; Y0 -> Y1 (aviso)
function buildTankLadder(w) {
  const contact = (tool, rid, addr) => { w.placeTool(tool, rid, 0, 0); w.document.getElementById('mdl-addr').value = addr; w.confirmModal(); };
  const coil = (tool, rid, addr) => { w.placeTool(tool, rid, 0, 0); w.document.getElementById('mdl-addr').value = addr; w.confirmModal(); };
  w.rungs[0].paths = [[]]; w.rungs[0].outputs = [];            // se parte del renglón por defecto, vacío
  const r1 = w.rungs[0].id; contact('NO', r1, 'X0'); coil('SET', r1, 'Y0'); w.rungs[0].comment = 'Nivel bajo: arrancar la bomba';
  w.addRung(); const r2 = w.rungs[1].id; contact('NO', r2, 'X1'); coil('RESET', r2, 'Y0'); w.rungs[1].comment = 'Nivel alto: parar la bomba';
  w.addRung(); const r3 = w.rungs[2].id; contact('NO', r3, 'Y0'); coil('COIL', r3, 'Y1'); w.rungs[2].comment = 'Aviso: bomba en marcha';
}
// Secuencia de verificación común (firmware real / simulador): bajo -> arranca; se mantiene; alto -> para
const TANK_STEPS = [['in', 0, 1], ['scan', 3], ['print'], ['scan', 15], ['print'], ['in', 0, 0], ['scan', 3], ['print'], ['in', 1, 1], ['scan', 3], ['print']];
const out4 = o => o.filter(l => l.startsWith('OUT')).map(l => l.split(' ').slice(1, 5).join('')).join(',');
module.exports = { R, D, bootPage, tick, mkEsp, buildTankFbd, buildTankLadder, TANK_STEPS, out4 };
