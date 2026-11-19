'use strict';
// Harness: ejecuta el MISMO programa drawflow en (a) firmware real compilado en host
// (plc_runtime.cpp sin modificar) y (b) simulador JS real (simulator/*.js sin modificar).
const fs = require('fs'), vm = require('vm'), path = require('path');
const { spawnSync } = require('child_process');
const REPO = process.env.REPO || require('path').resolve(__dirname,'..');
const FW = process.env.FWBIN || path.join(__dirname, 'hostfw/fwhost');

function program(nodes, links) {
  const data = {};
  nodes.forEach(n => {
    data[String(n.id)] = { id: n.id, name: n.name, data: n.data || {}, class: n.name, html: '',
      typenode: false, inputs: {}, outputs: { output_1: { connections: [] } }, pos_x: 0, pos_y: 0 };
  });
  links.forEach(([a, b, port]) => data[String(a)].outputs.output_1.connections.push({ node: String(b), output: 'input_' + (port || 1) }));
  return { drawflow: { Home: { data } } };
}

// steps: ['in',0,1] ['ai',4000] ['scan',n] ['adv',ms] ['print'] ['node',id]
function runFirmware(prog, steps) {
  const f = path.join(require('os').tmpdir(), 'prog_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(f, JSON.stringify(prog));
  const script = steps.map(s => s.join(' ')).join('\n') + '\n';
  const r = spawnSync(FW, [f], { input: script, encoding: 'utf8' });
  fs.unlinkSync(f);
  if (r.status !== 0) throw new Error("fw failed: " + r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

function runSim(prog, steps) {
  let T = 1000;
  const ctx = { console: { log() {}, warn() {}, error() {} }, performance: { now: () => T },
    window: {}, document: { addEventListener() {} }, localStorage: {}, setInterval() {}, clearInterval() {} };
  vm.createContext(ctx);
  const code = ['plc_sim_state.js', 'plc_sim_io.js', 'plc_sim_runtime.js']
    .map(f => fs.readFileSync(path.join(REPO, 'simulator', f), 'utf8')).join('\n');
  vm.runInContext(code + '\n;this.__x={SimState,parseProgram,plcScan,PLC_MODE};', ctx);
  const { SimState, parseProgram, plcScan, PLC_MODE } = ctx.__x;
  parseProgram(JSON.stringify(prog));
  SimState.plcMode = PLC_MODE.RUN;
  const out = [];
  for (const s of steps) {
    if (s[0] === 'in') SimState.inputs[s[1]] = !!s[2];
    else if (s[0] === 'ai') SimState.analog[s[1]] = s[2];
    else if (s[0] === 'scan') for (let i = 0; i < s[1]; i++) { plcScan(); T += 10; }
    else if (s[0] === 'adv') T += s[1];
    else if (s[0] === 'print') { const o = SimState.outputs.map(v => v ? 1 : 0), p = SimState.pwmValues;
      out.push(`OUT ${o.join(' ')} PWM ${p.join(' ')}`); }
    else if (s[0] === 'order') out.push(SimState.execOrder.map(i => SimState.nodes[i].id).join(' ') + ' ');
    else if (s[0] === 'node') { const n = SimState.nodes.find(n => n.id === s[1]);
      out.push(`NODE ${s[1]} ${n.name} state=${n.state ? 1 : 0} int=${n.intValue}`); }
  }
  return out;
}

let pass = 0, fail = 0; const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  -> ' + detail : ''));
}
module.exports = { program, runFirmware, runSim, check, REPO, summary: () => ({ pass, fail, results }) };
