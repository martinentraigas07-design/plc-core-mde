const H = require('./harness');
const { program, runFirmware, runSim, check } = H;

// ---- D1: AI1 -> SCALE -> CMP(>50) -> OUT1 ----
{
  const p = program([
    { id: 1, name: 'analog1' },
    { id: 2, name: 'scale', data: { inMin: '0', inMax: '4095', outMin: '0', outMax: '100' } },
    { id: 3, name: 'cmp', data: { op: '>', value: '50' } },
    { id: 4, name: 'output1' }], [[1, 2], [2, 3], [3, 4]]);
  for (const [ai, expect] of [[4000, 1], [3000, 1], [1000, 0], [0, 0]]) {
    const st = [['ai', 0, ai], ['scan', 5], ['print'], ['node', 2]];
    const fw = runFirmware(p, st), sm = runSim(p, st);
    check(`D1 AI->SCALE->CMP>50 AI=${ai} esperado OUT1=${expect} [FW]`, fw[0].startsWith('OUT ' + expect), fw[0] + ' | ' + fw[1]);
    check(`D1 AI->SCALE->CMP>50 AI=${ai} esperado OUT1=${expect} [SIM]`, sm[0].startsWith('OUT ' + expect), sm[0] + ' | ' + sm[1]);
  }
}
// ---- D1b: SCALE truncado (FW) vs redondeado (SIM) ----
{
  const p = program([
    { id: 1, name: 'analog1' },
    { id: 2, name: 'scale', data: { inMin: '0', inMax: '4095', outMin: '0', outMax: '100' } }], [[1, 2]]);
  const st = [['ai', 0, 2047], ['scan', 2], ['node', 2]];
  const fw = runFirmware(p, st), sm = runSim(p, st);
  check('D1b SCALE(2047)->0..100 igual en FW y SIM', fw[0] === sm[0], `FW: ${fw[0]} | SIM: ${sm[0]}`);
}
// ---- D2: orden de nodos (cadena declarada al reves) ----
{
  // IN1 -> NOT -> NOT -> NOT -> OUT1, declarada en orden inverso
  const p = program([
    { id: 5, name: 'output1' }, { id: 4, name: 'not' }, { id: 3, name: 'not' }, { id: 2, name: 'not' }, { id: 1, name: 'input1' }],
    [[1, 2], [2, 3], [3, 4], [4, 5]]);
  const lat = (run) => { const st = [['in', 0, 1]]; for (let i = 0; i < 6; i++) st.push(['scan', 1], ['print']); return run(p, st); };
  for (const [nm, run] of [['FW', runFirmware], ['SIM', runSim]]) {
    const o = lat(run); const first = o.findIndex(l => l.startsWith('OUT 0')); // IN=1 -> NOT^3 = 0
    check(`D2 cadena inversa NOT^3: salida correcta en el 1er scan [${nm}]`, first === 0, 'secuencia: ' + o.map(l => l[4]).join(''));
  }
}
// ---- D2b: glitch en enclavamiento: OUT = IN1 AND NOT(IN1) debe ser siempre 0 ----
{
  const p = program([
    { id: 4, name: 'output1' }, { id: 3, name: 'and' }, { id: 2, name: 'not' }, { id: 1, name: 'input1' }],
    [[1, 3], [1, 2], [2, 3], [3, 4]]);
  const st = [['in', 0, 1], ['scan', 1], ['print'], ['scan', 1], ['print'], ['in', 0, 0], ['scan', 1], ['print'], ['scan', 1], ['print'], ['in', 0, 1], ['scan', 1], ['print']];
  for (const [nm, run] of [['FW', runFirmware], ['SIM', runSim]]) {
    const o = run(p, st);
    check(`D2b X AND NOT(X) siempre 0 (sin glitch) [${nm}]`, o.every(l => l.startsWith('OUT 0')), o.map(l => l[4]).join(''));
  }
}
const s = H.summary(); console.log(`\nTOTAL pass=${s.pass} fail=${s.fail}`);
