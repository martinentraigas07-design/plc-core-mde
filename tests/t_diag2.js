const H = require('./harness');
const { program, runFirmware, runSim, check } = H;
const both = (name, p, st, pred) => { for (const [nm, run] of [['FW', runFirmware], ['SIM', runSim]]) { const o = run(p, st); const r = pred(o); check(`${name} [${nm}]`, r.ok, r.msg); } };
const out1 = o => o.map(l => l.split(' ')[1]).join('');

// ---- C1: CTU directo vs CTU+R_TRIG; latencia y conteo con pulsos de 1 scan ----
{
  const direct = program([{id:1,name:'input1'},{id:2,name:'ctu',data:{value:'3'}},{id:3,name:'output1'}],[[1,2],[2,3]]);
  const viaTrig = program([{id:1,name:'input1'},{id:2,name:'r_trig'},{id:3,name:'ctu',data:{value:'3'}},{id:4,name:'output1'}],[[1,2],[2,3],[3,4]]);
  // 3 pulsos de 1 scan (10 ms) separados por 3 scans. Se imprime tras cada scan.
  const st = []; for (let k = 0; k < 3; k++) { st.push(['in',0,1],['scan',1],['print'],['in',0,0],['scan',1],['print'],['scan',1],['print']); }
  st.push(['scan',2],['print']);
  const idxFirst = o => o.findIndex(l => l.startsWith('OUT 1'));
  for (const [nm, run] of [['FW', runFirmware], ['SIM', runSim]]) {
    const a = run(direct, st), b = run(viaTrig, st);
    const ia = idxFirst(a), ib = idxFirst(b);
    check(`C1 CTU(PV=3) directo con 3 pulsos de 10 ms llega a Q [${nm}]`, ia >= 0, 'Q en print#' + ia);
    check(`C1 CTU(PV=3) via R_TRIG con 3 pulsos de 10 ms llega a Q [${nm}]`, ib >= 0, 'Q en print#' + ib);
    check(`C1 R_TRIG+CTU no agrega retardo respecto de CTU directo [${nm}]`, ia === ib, `directo=print#${ia} via_trig=print#${ib}`);
  }
}
// ---- C2: R_TRIG alimenta dos consumidores: OUT1 directo y CTU. Ambos deben ver el pulso en el mismo scan ----
{
  const p = program([{id:1,name:'input1'},{id:2,name:'r_trig'},{id:3,name:'output1'},{id:4,name:'ctu',data:{value:'1'}},{id:5,name:'output2'}],[[1,2],[2,3],[2,4],[4,5]]);
  const st = [['scan',2],['in',0,1],['scan',1],['print'],['scan',1],['print'],['scan',1],['print']];
  for (const [nm, run] of [['FW', runFirmware], ['SIM', runSim]]) {
    const o = run(p, st).map(l => l.split(' ').slice(1,3).join(''));
    // En un PLC correcto: OUT1(pulso)=1 y el CTU cuenta en el MISMO scan => OUT2 sube cuando OUT1 esta en 1
    check(`C2 pulso R_TRIG y su CTU consistentes en el mismo scan [${nm}]`, o[0] === '11', 'OUT1,OUT2 por scan: ' + o.join(' '));
  }
}
// ---- C3: CTD y reset ----
{
  const p = program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'ctd',data:{value:'2'}},{id:4,name:'output1'}],[[1,3],[2,3],[3,4]]);
  const st = [['in',1,1],['scan',2],['in',1,0],['scan',2],['print'],  // carga PV=2 -> Q=0
              ['in',0,1],['scan',2],['in',0,0],['scan',2],['print'], // 1 flanco -> cnt 1, Q=0
              ['in',0,1],['scan',2],['in',0,0],['scan',2],['print']]; // 2do flanco -> cnt 0, Q=1
  both('C3 CTD PV=2: Q=0,0,1', p, st, o => ({ ok: out1(o) === '001', msg: out1(o) }));
}
// ---- C4: CTU con reset ----
{
  const p = program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'ctu',data:{value:'2'}},{id:4,name:'output1'}],[[1,3],[2,3],[3,4]]);
  const pulse = [['in',0,1],['scan',2],['in',0,0],['scan',2]];
  const st = [...pulse,...pulse,['print'],['in',1,1],['scan',2],['print'],['in',1,0],['scan',1],['print']];
  both('C4 CTU PV=2: 2 pulsos->Q=1, reset->Q=0, queda 0', p, st, o => ({ ok: out1(o) === '100', msg: out1(o) }));
}
// ---- S1: SR set-dominante / RS reset-dominante con S=R=1 ----
{
  const mk = t => program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:t},{id:4,name:'output1'}],[[1,3],[2,3],[3,4]]);
  const st = [['in',0,1],['in',1,1],['scan',3],['print'],['in',0,0],['in',1,0],['scan',3],['print']];
  both('S1 SR con S=R=1 => Q=1 y se mantiene', mk('sr'), st, o => ({ ok: out1(o) === '11', msg: out1(o) }));
  both('S1 RS con S=R=1 => Q=0 (reset domina)', mk('rs'), st, o => ({ ok: out1(o) === '00', msg: out1(o) }));
}
// ---- F1: automantenimiento con realimentacion (OR + AND NOT) con ids "hacia atras" ----
{
  // OUT1 <- AND3 ; AND3 <- OR2 , NOT4 ; OR2 <- IN1 , AND3 (lazo) ; NOT4 <- IN2
  const p = program([{id:1,name:'input1'},{id:2,name:'or'},{id:3,name:'and'},{id:4,name:'not'},{id:5,name:'input2'},{id:6,name:'output1'}],
    [[1,2],[3,2],[2,3],[4,3],[5,4],[3,6]]);
  const st = [['scan',2],['print'],['in',0,1],['scan',2],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
  both('F1 arranque/paro con realimentacion: 0,1,1(mantiene),0(paro),0', p, st, o => ({ ok: out1(o) === '01100', msg: out1(o) }));
}
// ---- F2: SR con realimentacion de su Q a un AND (enclavamiento): interlock motor 1/motor 2 ----
{
  // M1 = SR(S=IN1 AND NOT Q2 ; R=NOT... ) simplificado: Q1 set por IN1 si Q2=0 ; Q2 set por IN2 si Q1=0
  const p = program([
    {id:1,name:'input1'},{id:2,name:'input2'},
    {id:3,name:'and'},{id:4,name:'and'},{id:5,name:'not'},{id:6,name:'not'},
    {id:7,name:'sr'},{id:8,name:'sr'},{id:9,name:'output1'},{id:10,name:'output2'}],
    [[1,3],[6,3],[2,4],[5,4],[3,7],[4,8],[7,5],[8,6],[7,9],[8,10]]);
  // IN1 y IN2 al mismo tiempo: debe quedar solo UNO activo (nunca ambos)
  const st = [['in',0,1],['in',1,1],['scan',1],['print'],['scan',1],['print'],['scan',5],['print']];
  both('F2 interlock: IN1 e IN2 simultaneas => nunca OUT1=OUT2=1', p, st, o => ({ ok: o.every(l => !(l.startsWith('OUT 1 1'))), msg: o.map(l => l.slice(4,8)).join(' | ') }));
}
// ---- T: temporizadores (tiempo controlado) ----
{
  const mk = (t, ms) => program([{id:1,name:'input1'},{id:2,name:t,data:{time:String(ms)}},{id:3,name:'output1'}],[[1,2],[2,3]]);
  both('T1 TON 100 ms: sube tras 100 ms', mk('ton',100), [['in',0,1],['scan',5],['print'],['scan',7],['print'],['in',0,0],['scan',2],['print']], o => ({ ok: out1(o) === '010', msg: out1(o) }));
  both('T2 TOF 100 ms: sube ya, cae tras 100 ms', mk('tof',100), [['in',0,1],['scan',2],['print'],['in',0,0],['scan',5],['print'],['scan',7],['print']], o => ({ ok: out1(o) === '110', msg: out1(o) }));
  both('T3 TP 100 ms: pulso fijo aunque IN siga en 1', mk('tp',100), [['in',0,1],['scan',3],['print'],['scan',12],['print'],['in',0,0],['scan',2],['in',0,1],['scan',2],['print']], o => ({ ok: out1(o) === '101', msg: out1(o) }));
  both('T4 BLINK 50 ms con EN=IN1', mk('blink',50), [['in',0,1],['scan',2],['print'],['scan',5],['print'],['scan',5],['print'],['in',0,0],['scan',2],['print']], o => ({ ok: out1(o).endsWith('0') , msg: out1(o) }));
}
// ---- L: compuertas ----
{
  const g = t => program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:t},{id:4,name:'output1'}],[[1,3],[2,3],[3,4]]);
  const tt = (t, exp) => { const st = []; [[0,0],[0,1],[1,0],[1,1]].forEach(([a,b]) => st.push(['in',0,a],['in',1,b],['scan',2],['print']));
    both(`L ${t.toUpperCase()} tabla de verdad ${exp}`, g(t), st, o => ({ ok: out1(o) === exp, msg: out1(o) })); };
  tt('and','0001'); tt('or','0111'); tt('xor','0110');
  const n = program([{id:1,name:'input1'},{id:2,name:'not'},{id:3,name:'output1'}],[[1,2],[2,3]]);
  both('L NOT tabla de verdad 10', n, [['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['print']], o => ({ ok: out1(o) === '10', msg: out1(o) }));
}
// ---- P: PWM ----
{
  const p = program([{id:1,name:'analog1'},{id:2,name:'pwm',data:{out:'0'}}],[[1,2]]);
  both('P1 AI1->PWM directo copia el ADC', p, [['ai',0,1234],['scan',2],['print']], o => ({ ok: / PWM 1234 /.test(o[0]), msg: o[0] }));
  const q = program([{id:1,name:'analog1'},{id:2,name:'scale',data:{inMin:'0',inMax:'4095',outMin:'0',outMax:'4095'}},{id:3,name:'pwm',data:{out:'0'}}],[[1,2],[2,3]]);
  both('P2 Ej.6.1 AI1->SCALE(0-4095)->PWM: PWM = ADC (ADC=2047)', q, [['ai',0,2047],['scan',2],['print']], o => ({ ok: / PWM 2047 /.test(o[0]), msg: o[0] }));
}
const s = H.summary(); console.log(`\nTOTAL pass=${s.pass} fail=${s.fail}`);
