'use strict';
// E4c (head reutilizada de E4b) — Revisión E4b/1 — ¿Por qué se rechazan los 8 ejercicios con realimentación y existe una transformación estructural exacta?
//  Hallazgo: en el motor, cada componente fuertemente conexo (SCC) con lazo corta las aristas SALIENTES de un "pivote" =
//  el bloque con memoria de MENOR ID del SCC (o el nodo de menor ID si no hay ninguno). Los consumidores dentro del SCC leen
//  el valor del SCAN ANTERIOR del pivote. Por tanto:
//    · SCC con UN solo bloque con memoria  → semántica independiente de los ID (el pivote es siempre ese bloque);
//    · SCC con ≥2 bloques con memoria      → el retardo cae en la arista que elija el menor ID: depende del orden de creación.
const path=require('path'),fs=require('fs'),os=require('os'),{spawnSync}=require('child_process');
const R=process.env.REPO||path.resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const IC=require(path.join(R,'js/compiler/ir_check.js'));
const H=require('./harness'); const {check}=H;
console.warn=()=>{};console.info=()=>{};
const corpus={};
for(const c of ['ch01_03','ch04','ch05','ch06','ch07','ch08','ch10','ch11_5box']){const f=path.join(os.tmpdir(),'e4b_'+process.pid+'_'+c+'.json');
  spawnSync('node',[path.join(__dirname,'manual',c+'.js')],{env:Object.assign({},process.env,{E4_CORPUS_OUT:f})});
  JSON.parse(fs.readFileSync(f)).forEach((e,i)=>corpus[c+'#'+(i+1)]=e.prog); fs.unlinkSync(f);}
const MEM=['ton','tof','tp','blink','ctu','ctd','sr','rs','r_trig','f_trig'];
function scc(ir){const n=ir.program.nodes,idx={},low={},on={},st=[],comp={};let k=0,cc=0;
 const succ=i=>{const s=[];n.forEach((m,j)=>{if(m.in1===i||m.in2===i)s.push(j);});return s;};
 (function run(){const v=i=>{idx[i]=low[i]=++k;st.push(i);on[i]=1;for(const j of succ(i)){if(!idx[j]){v(j);low[i]=Math.min(low[i],low[j]);}else if(on[j])low[i]=Math.min(low[i],idx[j]);}
  if(low[i]===idx[i]){let j;do{j=st.pop();on[j]=0;comp[j]=cc;}while(j!==i);cc++;}};n.forEach((_,i)=>{if(!idx[i])v(i);});})();
 const g={};n.forEach((m,i)=>{(g[comp[i]]=g[comp[i]]||[]).push(i);});
 return Object.values(g).filter(a=>a.length>1).map(a=>({n:a.length,mem:a.filter(i=>MEM.includes(n[i].type)).map(i=>n[i].type)}));}
function relabel(prog,perm){const d=prog.drawflow.Home.data,o={};for(const k in d){const n=JSON.parse(JSON.stringify(d[k]));n.id=perm[+k];
  for(const p in n.outputs)n.outputs[p].connections.forEach(c=>c.node=String(perm[+c.node]));o[String(perm[+k])]=n;}return {drawflow:{Home:{data:o}}};}
function deBruijn(){const K=4,Nn=6,a=new Array(K*Nn).fill(0),db=[];(function rec(t,p){if(t>Nn){if(Nn%p===0)for(let j=1;j<=p;j++)db.push(a[j]);}else{a[t]=a[t-p];rec(t+1,p);for(let j=a[t-p]+1;j<K;j++){a[t]=j;rec(t+1,t);}}})(1,1);return db;}
const DB=deBruijn();   // todas las ventanas de 6 pasos de (X0,X1) aparecen en la secuencia
function steps(pre){const st=[];DB.forEach(v=>{st.push(['in',0,v&1],['in',1,v>>1],['scan',1],['print']);});
 let s=12345;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 for(let i=0;i<1500;i++){if(r()<.4)st.push(['in',0,r()<.5?1:0]);if(r()<.4)st.push(['in',1,r()<.5?1:0]);if(r()<.3)st.push(['adv',[10,100,pre||100,500][(r()*4)|0]]);st.push(['scan',1],['print']);}return st;}
const lc=(s=>()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;})(7);
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n}), E=(v,e)=>({type:'EDGE',var:v,edge:e}), B=(bt,id,p)=>({type:'BLOCK',blockType:bt,id,preset:p});
const co=(v,m,dom)=>{const c={type:'COIL',var:v,mode:m||'NORMAL'};if(dom)c.dom='R';return c;};
const rg=(id,paths,outs)=>({id,comment:'',paths,outputs:outs||[]});
const L={ // traducciones manuales a Ladder (el latch/contador es el único bloque con memoria del lazo)
 'ch01_03#7':[rg('a',[[E('X1','P'),K('M0',1)]],[co('M0','SET')]),rg('b',[[E('X1','P'),K('M0')]],[co('M0','RESET')]),rg('c',[[K('M0')]],[co('Y0')])],
 'ch01_03#17':[rg('a',[[E('X0','N'),K('M0',1)]],[co('M0','SET')]),rg('b',[[E('X0','N'),K('M0')]],[co('M0','RESET')]),rg('c',[[K('M0')]],[co('Y0')]),rg('d',[[K('M0',1)]],[co('Y1')])],
 'ch11_5box#2':[rg('a',[[K('X0'),K('M0',1)]],[co('M0','SET')]),rg('b',[[K('X0'),K('M0')]],[co('M0','RESET')]),rg('c',[[K('M0')]],[co('Y0')])],
 'ch05#6':[rg('a',[[E('X0','P'),B('CTU','C0',10)]]),rg('b',[[K('C0')],[K('X1')]],[co('C0','RESET')]),rg('c',[[K('C0'),B('CTU','C1',10)]]),rg('d',[[K('X1')]],[co('C1','RESET')]),rg('e',[[K('C1')]],[co('Y0')])],
 // ≥2 bloques con memoria en el lazo: traducción "natural" a Ladder, sólo para mostrar que no es equivalente de forma general
 'ch08#6':[rg('a',[[K('X0')]],[co('M0','SET','R')]),rg('b',[[K('X1')],[K('T0')]],[co('M0','RESET','R')]),rg('c',[[K('M0'),B('TON','T0',180000)]]),rg('d',[[K('T0')]],[co('Y1','SET')]),rg('e',[[K('X0')]],[co('Y1','RESET')]),rg('f',[[K('M0')]],[co('Y0')])],
};
const STRUCT=['ch01_03#7','ch01_03#17','ch11_5box#2','ch05#6'], MULTI=['ch01_03#10','ch08#6','ch08#7','ch10#6'];
const sig=(ir)=>JSON.stringify(scc(ir).map(s=>s.mem.slice().sort()));

// ═════ E4c: conversión FBD→Ladder de lazos con UN solo bloque con memoria, con validación estructural ═════
const opts={compile:C.compileLadder,check:IC};
const fromRungs=(rungs)=>({drawflow:C.irToDrawflow(C.compileLadder({rungs}).program.nodes).drawflow});
for(const nm of STRUCT){
  const prog=corpus[nm],ir=C.compileFBD(prog),cv=D.convertIRToLadder(ir,opts);
  check(`C1 ${nm}: se convierte y queda verificado`,cv.ok&&cv.verified,JSON.stringify(cv.reasons));
  if(!cv.ok)continue;
  const ir2=C.compileLadder({rungs:cv.rungs});
  const A=D.analyzeLoops(ir),B=D.analyzeLoops(ir2);
  check(`C2 ${nm}: mismos lazos (${A.length}) con exactamente 1 bloque con memoria del mismo tipo`,A.length===B.length&&A.every(l=>l.memCount===1&&l.acyclicAfterCut)&&B.every(l=>l.memCount===1&&l.acyclicAfterCut)&&JSON.stringify(A.map(l=>l.memTypes[0]).sort())===JSON.stringify(B.map(l=>l.memTypes[0]).sort()));
  check(`C3 ${nm}: ninguna marca auxiliar ni detector de flanco DENTRO del lazo (marcas fuera del lazo: ${(cv.marks||[]).length})`,B.every(l=>l.idxs.every(i=>!['r_trig','f_trig'].includes(ir2.program.nodes[i].type))&&l.memCount===1));
  const pre=Math.max(0,...ir.program.nodes.map(n=>n.preset|0)),st=steps(pre),pL={drawflow:C.irToDrawflow(ir2.program.nodes).drawflow};
  check(`C4 ${nm}: diferencial firmware FBD==Ladder generado (${st.length} pasos)`,H.runFirmware(prog,st).join('|')===H.runFirmware(pL,st).join('|'));
  check(`C5 ${nm}: diferencial simulador FBD==Ladder generado`,H.runSim(prog,st).join('|')===H.runSim(pL,st).join('|'));
  // independencia del orden de ID: se renumera el FBD, se vuelve a convertir y el resultado conserva comportamiento
  const ids=ir.program.nodes.map(n=>n.id);let okAll=true,T=8;const base=H.runFirmware(prog,st).join('|');
  for(let t=0;t<T;t++){const p=ids.slice();for(let i=p.length-1;i>0;i--){const j=(lc()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}const perm={};ids.forEach((id,i)=>perm[id]=p[i]);
    const pr=relabel(prog,perm),irr=C.compileFBD(pr),c2=D.convertIRToLadder(irr,opts);
    if(!c2.ok||H.runFirmware(fromRungs(c2.rungs),st).join('|')!==base)okAll=false;}
  check(`C6 ${nm}: con ${T} renumeraciones de ID del FBD la conversión sigue aceptada y con el mismo comportamiento`,okAll);
}
for(const nm of MULTI){
  const cv=D.convertIRToLadder(C.compileFBD(corpus[nm]),opts);
  check(`C7 ${nm}: se mantiene el rechazo y se explica la dependencia de los ID`,!cv.ok&&/memory blocks/.test(cv.reasons.join())&&/identifiers/.test(cv.reasons.join()),cv.reasons.join().slice(0,160));
}
// negativos
{ const ir=C.compileFBD(corpus['ch01_03#7']);
  // sin compile/check no se puede validar estructuralmente → rechazo
  const r0=D.convertIRToLadder(ir,{});
  check('C8 lazo sin compile/check: rechazado (no se acepta sin validación estructural)',!r0.ok);
  // un Ladder regenerado que meta una marca (2º bloque con memoria) en el lazo debe rechazarse
  const bad=(x)=>{const o=C.compileLadder(x);const nodes=o.program.nodes;const l=D.analyzeLoops(o)[0];
    if(l){const t=l.idxs.find(i=>nodes[i].type!=='sr'&&nodes[i].type!=='rs'&&nodes[i].type!=='ctu'&&nodes[i].type!=='ton')||l.idxs[0];
      const j=nodes.length;nodes.push({id:j,type:'rs',in1:t,in2:t,address:{area:'M',index:60}});
      nodes.forEach((n,k)=>{if(k!==j&&k!==t&&l.idxs.includes(k)){if(n.in1===t)n.in1=j;if(n.in2===t)n.in2=j;}});}
    return o;};
  const r1=D.convertIRToLadder(ir,{compile:bad,check:IC});
  check('C9 marca auxiliar dentro del lazo del Ladder regenerado: rechazado',!r1.ok&&/Structural validation/.test(r1.reasons.join()),r1.reasons.join().slice(0,120));
  const r2=D.convertIRToLadder(ir,{compile:()=>C.compileLadder({rungs:[rg('z',[[K('X0')]],[co('Y0')])]}),check:IC});
  check('C10 Ladder regenerado sin el lazo: rechazado',!r2.ok&&/Structural validation/.test(r2.reasons.join()));
}

const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
