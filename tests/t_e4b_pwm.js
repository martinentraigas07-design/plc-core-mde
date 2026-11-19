'use strict';
// Revisión E4b/3 — Diferencia PWM>2048 entre simulador y firmware.
//  Pregunta: ¿es sólo visual o puede cambiar el comportamiento de un programa (p.ej. realimentación por la salida digital)?
//  Método: se ejecuta el simulador REAL dos veces, con y sin el espejo `SimState.outputs[i] = (value > 2048)` de plcWritePWM,
//  sobre programas con PWM + salida digital en el mismo pin + contactos que leen Y, y se compara TODO lo que la lógica puede ver:
//  estado/valor de cada nodo y las tablas de memoria X, Y, M, T, C, A, R. Sólo puede diferir SimState.outputs[] de los pines PWM.
const fs=require('fs'),vm=require('vm'),path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const H=require('./harness'); const {check}=H;
console.warn=()=>{};console.info=()=>{};
const MIRROR='SimState.outputs[outIdx] = (value > 2048);';
const ioSrc=fs.readFileSync(path.join(R,'simulator/plc_sim_io.js'),'utf8');
check('PWM.0 el espejo existe exactamente en plc_sim_io.js (y sólo ahí escribe SimState.outputs desde PWM)',ioSrc.includes(MIRROR));
// ¿quién lee SimState.outputs? (si sólo lo leen el panel y /status, no hay realimentación lógica posible)
const readers=[];
for(const f of fs.readdirSync(path.join(R,'simulator')).filter(f=>f.endsWith('.js'))){const t=fs.readFileSync(path.join(R,'simulator',f),'utf8');
  t.split('\n').forEach((l,i)=>{ if(/SimState\.outputs/.test(l)&&!/outputs\[[^\]]+\]\s*=[^=]/.test(l)&&!/outputs\.fill/.test(l)&&!/outputs\.length/.test(l)&&!/^\s*\/\//.test(l)) readers.push(f+':'+(i+1)); }); }
console.log('# lectores de SimState.outputs:',readers.join(', '));
check('PWM.1 SimState.outputs sólo lo leen /status (io.out) y el panel de LEDs (no el motor ni la memoria)',readers.every(r=>/plc_sim_scan\.js|sim_panel\.js/.test(r)),readers.join(', '));
function simRun(prog,steps,patched){
  let T=1000;
  const ctx={console:{log(){},warn(){},error(){}},performance:{now:()=>T},window:{},document:{addEventListener(){}},localStorage:{},setInterval(){},clearInterval(){}};
  vm.createContext(ctx);
  const code=['plc_sim_state.js','plc_sim_io.js','plc_sim_runtime.js'].map(f=>{let t=fs.readFileSync(path.join(R,'simulator',f),'utf8');return (patched&&f==='plc_sim_io.js')?t.replace(MIRROR,''):t;}).join('\n');
  vm.runInContext(code+'\n;this.__x={SimState,parseProgram,plcScan,PLC_MODE};',ctx);
  const {SimState,parseProgram,plcScan,PLC_MODE}=ctx.__x; parseProgram(JSON.stringify(prog)); SimState.plcMode=PLC_MODE.RUN;
  const rows=[];
  for(const s of steps){ if(s[0]==='in')SimState.inputs[s[1]]=!!s[2]; else if(s[0]==='ai')SimState.analog[s[1]]=s[2];
    else if(s[0]==='scan')for(let i=0;i<s[1];i++){plcScan();T+=10;} else if(s[0]==='adv')T+=s[1];
    else if(s[0]==='print')rows.push({logic:JSON.stringify({n:SimState.nodes.map(n=>[n.id,n.state?1:0,n.intValue]),mem:SimState.mem,pwm:SimState.pwmValues,x:SimState.inputs}),pins:SimState.outputs.map(v=>v?1:0)}); }
  return rows;
}
function steps(){const st=[];let s=99;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 for(let i=0;i<400;i++){if(r()<.4)st.push(['in',0,r()<.5?1:0]);if(r()<.4)st.push(['in',1,r()<.5?1:0]);if(r()<.5)st.push(['ai',0,[0,1000,2047,2048,2049,3000,4095][(r()*7)|0]]);if(r()<.2)st.push(['adv',[50,300][(r()*2)|0]]);st.push(['scan',1],['print']);}return st;}
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
const co=(v,m)=>({type:'COIL',var:v,mode:m||'NORMAL'});
const rg=(id,paths,outs,extra)=>Object.assign({id,comment:'',paths,outputs:outs||[]},extra||{});
const num=(chain)=>({id:'n',comment:'',kind:'NUM',paths:[],outputs:[],chain});
const CASES={
 'PWM numérico en Y0 + bobina digital Y0 + contacto Y0 que alimenta Y1 y un latch':
  [num([{fn:'AI1'},{fn:'SCALE',id:'S0',inMin:0,inMax:4095,outMin:0,outMax:4095},{fn:'PWM',out:0}]),
   rg('a',[[K('X0')]],[co('Y0')]), rg('b',[[K('Y0')]],[co('Y1')]), rg('c',[[K('Y0')]],[co('M0','SET')]), rg('d',[[K('X1')]],[co('M0','RESET')]), rg('e',[[K('M0')]],[co('Y2')])],
 'bobina PWM on/off en Y0 y lectura de Y0 como realimentación (autorretención)':
  [rg('a',[[K('X0')],[K('Y0')]].map(p=>p.concat([K('X1',1)])),[{type:'PWM',out:0,mode:'NORMAL',var:''}]), rg('b',[[K('Y0')]],[co('Y3')]), rg('c',[[K('Y0')]],[co('M1')]), rg('d',[[K('M1',1)]],[co('Y2')])],
 'PWM y salida digital en pines distintos (control)':
  [num([{fn:'AI1'},{fn:'SCALE',id:'S0',inMin:0,inMax:4095,outMin:0,outMax:4095},{fn:'PWM',out:2}]), rg('a',[[K('X0')]],[co('Y1')]), rg('b',[[K('Y1')]],[co('Y0')])],
};
const st=steps();
for(const [nm,rungs] of Object.entries(CASES)){
  const ir=C.compileLadder({rungs}); const prog={drawflow:C.irToDrawflow(ir.program.nodes).drawflow};
  const a=simRun(prog,st,false),b=simRun(prog,st,true);
  const logicSame=a.every((r,i)=>r.logic===b[i].logic);
  const pwmPins=ir.program.nodes.filter(n=>n.type==='pwm').map(n=>n.outIdx);
  const pinsDiffOnlyPwm=a.every((r,i)=>r.pins.every((v,p)=>v===b[i].pins[p]||pwmPins.includes(p)));
  const anyDiff=a.some((r,i)=>r.pins.some((v,p)=>v!==b[i].pins[p]));
  check(`PWM.2 [${nm}] lógica, estados de nodos y tablas de memoria idénticos con y sin espejo (${a.length} pasos)`,logicSame);
  check(`PWM.3 [${nm}] el espejo sólo cambia SimState.outputs de los pines PWM${anyDiff?'':' (aquí ni siquiera se observa)'}`,pinsDiffOnlyPwm);
}
// ── Lo que hace el firmware real en el pin PWM ──
const pioSrc=fs.readFileSync(path.join(R,'firmware/plc_io.cpp'),'utf8');
check('PWM.4 firmware: plcWriteOutput NO escribe un pin con PWM activo ("protegido por LEDC") → en HW el pin sólo refleja el duty',/if \(pwmTable\[n\]\.active\) return;/.test(pioSrc));
check('PWM.5 firmware: las salidas (GPIO 14,27,26,25) son pines distintos de las entradas → la lógica nunca lee el pin de salida',/outputPins\[NUM_OUTPUTS\]\s*=\s*\{\s*14, 27, 26, 25/.test(pioSrc)&&!/digitalRead\(outputPins/.test(pioSrc));
// ── El "FW host" del arnés no modela LEDC: la columna digital del pin PWM del arnés es el estado LÓGICO de la bobina ──
{ const rungs=[num([{fn:'AI1'},{fn:'SCALE',id:'S0',inMin:0,inMax:4095,outMin:0,outMax:4095},{fn:'PWM',out:0}]),rg('a',[[K('X0')]],[co('Y0')])];
  const ir=C.compileLadder({rungs}); const prog={drawflow:C.irToDrawflow(ir.program.nodes).drawflow};
  const run=(ai,x)=>{const s=[['in',0,x],['ai',0,ai],['scan',2],['print']];return [H.runFirmware(prog,s).filter(l=>l.startsWith('OUT'))[0].split(' ').slice(1,2)[0],H.runSim(prog,s).filter(l=>l.startsWith('OUT'))[0].split(' ').slice(1,2)[0]];};
  const t=[[4000,0],[4000,1],[100,1],[100,0]].map(([ai,x])=>`AI=${ai},X0=${x}: arnés FW=${run(ai,x)[0]} SIM=${run(ai,x)[1]}`);
  console.log('# columna digital del pin PWM:',t.join(' | '));
  const r=[run(4000,0),run(100,1)];
  check('PWM.6 la diferencia observada FW(arnés)≠SIM es: arnés = estado lógico de la bobina, SIM = (duty>2048); el pin físico real sigue al duty (PWM gana)',r[0][0]==='0'&&r[0][1]==='1'&&r[1][0]==='1'&&r[1][1]==='0',JSON.stringify(r)); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
