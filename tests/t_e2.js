'use strict';
// E2 — FBD -> Ladder -> FBD: equivalencia (oráculo + firmware + simulador), instancia única de bloques,
// supervivencia de parámetros, advertencias en lo no convertible.
const path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
const H=require('./harness'); const {program,runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const IC=require(path.join(R,'js/compiler/ir_check.js'));
const N=(id,name,data)=>({id,name,data:data||{}});
const OPTS={compile:C.compileLadder,check:IC};

function script(steps){const sc=[];let x=[false,false],a=-1;
  steps.forEach((s,k)=>{ if(s.x[0]!==x[0])sc.push(['in',0,s.x[0]?1:0]); if(s.x[1]!==x[1])sc.push(['in',1,s.x[1]?1:0]); x=s.x;
    if(s.a!==a){sc.push(['ai',0,s.a]);a=s.a;} sc.push(['adv',k===0?s.dt:s.dt-10]);sc.push(['scan',1]);sc.push(['print']);});
  return sc;}
const norm=o=>o.map(l=>{const t=l.split(' ');const p=t.slice(6,10);return t.slice(1,5).join('')+'/'+p.join(',');});
const SIG={ton:n=>n.preset,tof:n=>n.preset,tp:n=>n.preset,blink:n=>n.preset,ctu:n=>n.value,ctd:n=>n.value,
  cmp:n=>n.op+':'+n.value,scale:n=>[n.scaleInMin,n.scaleInMax,n.scaleOutMin,n.scaleOutMax].join(','),pwm:n=>n.outIdx,
  r_trig:n=>'',f_trig:n=>''};
const sigs=ir=>{const m={};ir.program.nodes.forEach(n=>{if(SIG[n.type]){const k=n.type+'('+SIG[n.type](n)+')';m[k]=(m[k]||0)+1;}});return m;};
const STATEFUL=['ton','tof','tp','blink','ctu','ctd','r_trig','f_trig','scale','pwm'];

function rt(name,fbd,opts){
  opts=opts||{};
  let ir;try{ir=C.compileFBD(fbd);}catch(e){check(name+': compila FBD',false,e.message);return;}
  const cv=D.convertIRToLadder(ir,OPTS);
  if(opts.reject){check(name+': rechazado con advertencia clara',!cv.ok&&cv.reasons.length>0,cv.reasons.join(' | ').slice(0,160));return;}
  if(!cv.ok){check(name+': convierte',false,cv.reasons.join(' | ').slice(0,200));return;}
  check(name+': convertido y verificado (oráculo)',cv.verified===true,(cv.verifiedSteps||0)+' scans, marcas='+cv.marks.join(','));
  let l2;try{l2=C.compileLadder({rungs:cv.rungs});}catch(e){check(name+': recompila Ladder',false,e.message);return;}
  // instancia única + parámetros
  const sa=sigs(ir), sb=sigs(l2);
  const cnt=(ir_,t)=>ir_.program.nodes.filter(n=>n.type===t).length;
  const single=STATEFUL.every(t=>cnt(ir,t)===cnt(l2,t));
  check(name+': una sola instancia de cada bloque con estado ('+STATEFUL.map(t=>t+':'+cnt(ir,t)+'/'+cnt(l2,t)).filter(s=>!/:0\/0/.test(s)).join(' ')+')',single);
  // un NOT aguas abajo de un CMP se absorbe invirtiendo el operador (== en vez de !=): es equivalente y se verifica con el oráculo
  const keys=Object.keys(sa).filter(k=>!/^cmp/.test(k));
  const sameParams=keys.every(k=>sb[k]===sa[k])&&Object.keys(sb).filter(k=>!/^cmp/.test(k)).every(k=>sa[k]===sb[k]);
  const INV={'>':'<=','<':'>=','>=':'<','<=':'>','==':'!=','!=':'=='};
  const cmpOk=Object.keys(sa).filter(k=>/^cmp/.test(k)).every(k=>{const m=/^cmp\((.*?):(.*)\)$/.exec(k);return sb[k]>=1||sb['cmp('+INV[m[1]]+':'+m[2]+')']>=1;});
  check(name+': parámetros conservados (TON/TOF/TP/BLINK/CTU/CTD/SCALE/CMP/PWM)',sameParams&&cmpOk,JSON.stringify(sa)+' vs '+JSON.stringify(sb));
  // FBD -> Ladder -> FBD (drawflow regenerado y recompilado como FBD)
  let ir3;try{const df=C.irToDrawflow(l2.program.nodes);ir3=C.compileFBD({drawflow:df.drawflow});}catch(e){check(name+': Ladder->FBD',false,e.message);return;}
  const eq3=IC.equivalent(ir,ir3,{sequences:6,length:800});
  check(name+': FBD -> Ladder -> FBD equivalente al original',eq3.ok,eq3.ok?'':JSON.stringify(eq3.diff));
  const sc=script(IC.genSteps(Math.max(...ir.program.nodes.map(n=>n.preset|0),0),99+name.length,500));
  const p2={drawflow:C.irToDrawflow(l2.program.nodes).drawflow};
  let ok=true,det='';
  for(const [rn,run] of [['FW',runFirmware],['SIM',runSim]]){
    const a=norm(run(fbd,sc)),b=norm(run(p2,sc));
    // el simulador refleja PWM>2048 en el digital: se compara completo entre el mismo motor
    if(a.join()!==b.join()){ok=false;det=rn+' difiere en scan '+a.findIndex((v,i)=>v!==b[i]);}
  }
  check(name+': FBD original == Ladder recompilado en firmware y simulador (500 scans)',ok,det);
}
const tin=[N(1,'input1'),N(2,'input2')];
// 1. Q compartida / negada / combinada con otra entrada
rt('E2.1 TON Q usada 3 veces (directa, negada, AND IN2)',program([...tin,N(3,'ton',{time:300}),N(4,'output1'),N(5,'not'),N(6,'output2'),N(7,'and'),N(8,'output3')],
  [[1,3],[3,4],[3,5],[5,6],[3,7,1],[2,7,2],[7,8]]));
rt('E2.2 TOF/TP: NOT(TP.Q) y XOR(TON.Q,IN2)',program([...tin,N(3,'tp',{time:400}),N(4,'not'),N(5,'output1'),N(6,'tof',{time:250}),N(7,'xor'),N(8,'output2'),N(9,'output3')],
  [[1,3],[3,4],[4,5],[2,6],[6,7,1],[2,7,2],[7,8],[6,9]]));
// 3. contadores con reset / carga y Q compartida
rt('E2.3 CTU reset + CTD carga, Q compartida',program([...tin,N(3,'ctu',{value:3}),N(4,'ctd',{value:4}),N(5,'output1'),N(6,'output2'),N(7,'or'),N(8,'output3'),N(9,'r_trig')],
  [[1,9],[9,3,1],[2,3,2],[1,4,1],[2,4,2],[3,5],[4,6],[3,7,1],[4,7,2],[7,8]]));
// 4. latches SR / RS
rt('E2.4 SR y RS con Q compartida',program([...tin,N(3,'sr'),N(4,'rs'),N(5,'output1'),N(6,'output2'),N(7,'and'),N(8,'output3')],
  [[1,3,1],[2,3,2],[1,4,1],[2,4,2],[3,5],[4,6],[3,7,1],[4,7,2],[7,8]]));
// 5. flancos inline, bajo AND/OR y compartidos
rt('E2.5 flancos: inline, dentro de AND, de una expresión, compartido',program([...tin,N(3,'r_trig'),N(4,'output1'),N(5,'f_trig'),N(6,'and'),N(7,'output2'),
  N(8,'or'),N(9,'r_trig'),N(10,'output3'),N(11,'output4')],
  [[1,3],[3,4],[2,5],[5,6,1],[1,6,2],[6,7],[1,8,1],[2,8,2],[8,9],[9,10],[9,11]]));
// 6. analógico
rt('E2.6 AI1->SCALE->CMP y AI1->SCALE->PWM',program([N(1,'analog1'),N(2,'scale',{inMin:100,inMax:3900,outMin:0,outMax:200}),N(3,'cmp',{op:'>=',value:120}),N(4,'output1'),
  N(5,'pwm',{out:2}),N(6,'cmp',{op:'<',value:30}),N(7,'output2'),N(8,'scale',{inMin:4095,inMax:0,outMin:10,outMax:90}),N(9,'pwm',{out:3}),N(10,'cmp',{op:'!=',value:50}),N(11,'not'),N(12,'output3')],
  [[1,2],[2,3],[3,4],[2,5],[2,6],[6,7],[1,8],[8,9],[8,10],[10,11],[11,12]]));
rt('E2.7 CMP combinado con entradas y SCALE en cascada',program([...tin,N(3,'analog1'),N(4,'scale',{inMin:0,inMax:4095,outMin:0,outMax:1000}),N(5,'scale',{inMin:0,inMax:1000,outMin:0,outMax:10}),
  N(6,'cmp',{op:'>',value:5}),N(7,'and'),N(8,'output1'),N(9,'pwm',{out:0})],
  [[3,4],[4,5],[5,6],[6,7,1],[1,7,2],[7,8],[4,9]]));
// 8. BLINK
rt('E2.8 BLINK habilitado por IN1 y su Q con TON',program([...tin,N(3,'blink',{time:200}),N(4,'output1'),N(5,'ton',{time:500}),N(6,'and'),N(7,'output2'),N(8,'not'),N(9,'output3')],
  [[1,3],[3,4],[2,5],[3,6,1],[5,6,2],[6,7],[3,8],[8,9]]));
// 9. realimentación por variable (autorretención) y por M
rt('E2.9 autorretención Y0=(X0+Y0)·/X1: realimentación, se rechaza (criterio conservador)',program([...tin,N(3,'or'),N(4,'not'),N(5,'and'),N(6,'output1')],[[1,3,1],[6,3,2],[2,4],[3,5,1],[4,5,2],[5,6]]),{reject:true});
// 10. expresión grande (SOP > 32 términos): descompone en marcas
{const nodes=[...tin],links=[];let id=3;const ors=[];
 for(let k=0;k<6;k++){const a=id++,b=id++,o=id++;nodes.push(N(a,'sr'),N(b,'sr'),N(o,'or'));links.push([k%2?1:2,a,1],[k%2?2:1,a,2],[1,b,1],[k%2?1:2,b,2],[a,o,1],[b,o,2]);ors.push(o);}
 let acc=ors[0];for(let k=1;k<6;k++){const g=id++;nodes.push(N(g,'and'));links.push([acc,g,1],[ors[k],g,2]);acc=g;}
 const y=id++;nodes.push(N(y,'output1'));links.push([acc,y]);
 rt('E2.10 expresión 6 OR de 2 → 64 términos (descomposición en marcas)',program(nodes,links));}
// 11. rechazos con advertencia
rt('E2.11 CMP sobre fuente booleana: se rechaza y se avisa',program([...tin,N(3,'cmp',{op:'>',value:0}),N(4,'output1')],[[1,3],[3,4]]),{reject:true});
rt('E2.12 PWM sin entrada: se rechaza y se avisa',program([N(1,'pwm',{out:1,value:500})],[]),{reject:true});
rt('E2.13 lazo combinacional: se rechaza y se avisa',program([...tin,N(3,'or'),N(4,'not'),N(5,'and'),N(6,'output1')],[[1,3,1],[5,3,2],[2,4],[3,5,1],[4,5,2],[5,6]]),{reject:true});
rt('E2.14 SR de un scan heredado SR(S=X,R=NOT X): se rechaza y se avisa',program([...tin,N(3,'not'),N(4,'sr'),N(5,'output1')],[[1,3],[1,4,1],[3,4,2],[4,5]]),{reject:true});
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
