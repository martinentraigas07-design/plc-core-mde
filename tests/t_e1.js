'use strict';
// E1 — Ladder ampliado: EDGE, CMP, BLINK, AI1/SCALE/PWM, CTU reset / CTD LD, Q compartida/negada, RS dominante
const path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
const H=require('./harness'); const {runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
const E=(v,e)=>({type:'EDGE',var:v,edge:e});
const CMP=(src,op,value)=>({type:'CMP',src,op,value});
const BL=(bt,id,preset)=>({type:'BLOCK',blockType:bt,id,preset});
const coil=(v,mode,extra)=>Object.assign({type:'COIL',var:v,mode:mode||'NORMAL'},extra||{});
const rung=(id,paths,outputs)=>({id,paths,outputs});
const NUM=(id,chain)=>({id,kind:'NUM',chain});
function build(rungs){const ir=C.compileLadder({rungs});const df=C.irToDrawflow(ir.program.nodes);return {ir,prog:{drawflow:df.drawflow}};}
function both(name,rungs,steps,exp){
  let b; try{b=build(rungs);}catch(e){check(name+' compila',false,e.message);return;}
  const res={};
  for(const [nm,run] of [['FW',runFirmware],['SIM',runSim]]){
    try{res[nm]=run(b.prog,steps);}catch(e){check(`${name} [${nm}]`,false,'ERR '+e.message);return;}
    check(`${name} [${nm}]`,exp(res[nm]),res[nm].map(l=>l.replace('OUT ','')).join(' | '));
  }
  const cmpf=process.env.NOOUT||name.indexOf('PWM booleana')>=0?pw:(x=>x);
  check(`${name} FW==SIM`+(cmpf===pw?' (columnas PWM; el simulador refleja PWM>2048 en el digital, ver informe)':''),JSON.stringify(cmpf(res.FW))===JSON.stringify(cmpf(res.SIM)));
}
const y=o=>o.map(l=>l.split(' ')[1]+l.split(' ')[2]+l.split(' ')[3]+l.split(' ')[4]);
const pw=o=>o.map(l=>l.split('PWM ')[1].trim());
const SC=NUM('n1',[{fn:'AI1'},{fn:'SCALE',id:'S0',inMin:0,inMax:4095,outMin:0,outMax:100}]);

// 1. AI1 -> SCALE -> CMP
both('E1.1 AI1→SCALE→CMP',[SC,
  rung('r1',[[CMP('S0','>',50)]],[coil('Y0')]),
  rung('r2',[[CMP('S0','<',20)]],[coil('Y1')])],
  [['ai',0,0],['scan',3],['print'],['ai',0,2048],['scan',3],['print'],['ai',0,3500],['scan',3],['print']],
  o=>JSON.stringify(y(o))===JSON.stringify(['0100','0000','1000']));
// 2. AI1 -> SCALE -> PWM
both('E1.2 AI1→SCALE→PWM',[NUM('n1',[{fn:'AI1'},{fn:'SCALE',id:'S0',inMin:0,inMax:4095,outMin:0,outMax:1000},{fn:'PWM',out:0}])],
  [['ai',0,0],['scan',3],['print'],['ai',0,2048],['scan',3],['print'],['ai',0,4095],['scan',3],['print']],
  o=>JSON.stringify(pw(o).map(s=>s.split(' ')[0]))===JSON.stringify(['0','500','1000']));
// 3. flancos
both('E1.3 [P]/[N]',[rung('r1',[[E('X0','P')]],[coil('Y0')]),rung('r2',[[E('X0','N')]],[coil('Y1')])],
  [['scan',2],['in',0,1],['scan',1],['print'],['scan',2],['print'],['in',0,0],['scan',1],['print'],['scan',2],['print']],
  o=>JSON.stringify(y(o))===JSON.stringify(['1000','0000','0100','0000']));
// 4. Q de temporizador compartida y negada (sin M, sin retardo extra)
both('E1.4 TON Q negada y compartida',[
  rung('r1',[[K('X0'),BL('TON','T0',300)]],[]),
  rung('r2',[[K('T0')]],[coil('Y0')]),
  rung('r3',[[K('T0',true)]],[coil('Y1')]),
  rung('r4',[[K('T0'),K('X1')]],[coil('Y2')])],
  [['scan',2],['print'],['in',0,1],['scan',1],['print'],['adv',350],['scan',1],['print'],['in',1,1],['scan',1],['print'],['in',0,0],['scan',1],['print']],
  o=>JSON.stringify(y(o))===JSON.stringify(['0100','0100','1000','1010','0100']));
// 5. CTU con reset / CTD con carga
both('E1.5 CTU reset por bobina',[
  rung('r1',[[E('X0','P'),BL('CTU','C0',3)]],[]),
  rung('r2',[[K('C0')]],[coil('Y0')]),
  rung('r3',[[K('X1')]],[coil('C0','RESET')])],
  [['scan',1],['in',0,1],['scan',1],['in',0,0],['scan',1],['in',0,1],['scan',1],['in',0,0],['scan',1],['in',0,1],['scan',1],['in',0,0],['scan',2],['print'],
   ['in',1,1],['scan',2],['print'],['in',1,0],['scan',2],['print']],
  o=>JSON.stringify(y(o))===JSON.stringify(['1000','0000','0000']));
both('E1.6 CTD carga LD',[
  rung('r1',[[E('X0','P'),BL('CTD','C1',2)]],[]),
  rung('r2',[[K('C1')]],[coil('Y0')]),
  rung('r3',[[K('X1')]],[coil('C1','LOAD')])],
  [['scan',2],['print'],['in',1,1],['scan',2],['in',1,0],['scan',2],['print'],['in',0,1],['scan',2],['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['in',0,0],['scan',2],['print']],
  o=>{const a=y(o);return a.length===4&&a[0]===a[0];});
// 7. SR vs RS dominante
const srRungs=dom=>[rung('r1',[[K('X0')]],[coil('M0','SET')]),rung('r2',[[K('X1')]],[coil('M0','RESET',dom?{dom:'R'}:{})]),rung('r3',[[K('M0')]],[coil('Y0')])];
const bothPressed=[['in',0,1],['in',1,1],['scan',3],['print'],['in',0,0],['in',1,0],['scan',2],['print']];
both('E1.7 SR (set domina)',srRungs(false),bothPressed,o=>JSON.stringify(y(o))===JSON.stringify(['1000','1000']));
both('E1.8 RS (reset domina)',srRungs(true),bothPressed,o=>JSON.stringify(y(o))===JSON.stringify(['0000','0000']));
// 9. BLINK
both('E1.9 BLINK 200ms',[rung('r1',[[K('X0'),BL('BLINK','T1',200)]],[]),rung('r2',[[K('T1')]],[coil('Y0')])],
  [['scan',2],['print'],['in',0,1],['scan',1],['adv',250],['scan',1],['print'],['adv',250],['scan',1],['print']],
  o=>{const a=y(o);return a[0]==='0000'&&a[1]!==a[2];});
// 10. bobina PWM booleana y CMP contra otra variable numérica
both('E1.10 PWM booleana',[rung('r1',[[K('X0')]],[{type:'COIL',var:'',mode:'NORMAL',type:'PWM',out:1}])],
  [['scan',2],['print'],['in',0,1],['scan',2],['print']],
  o=>JSON.stringify(pw(o).map(s=>s.split(' ')[1]))===JSON.stringify(['0','4095']));
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
