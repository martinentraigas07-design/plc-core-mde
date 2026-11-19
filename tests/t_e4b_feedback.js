'use strict';
// Revisión E4b/1 — ¿Por qué se rechazan los 8 ejercicios con realimentación y existe una transformación estructural exacta?
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
// ── A. Diagnóstico: rechazo, SCC, y dependencia de los ID ──
for(const nm of [...STRUCT,...MULTI]){
  const prog=corpus[nm],ir=C.compileFBD(prog),S=scc(ir);
  const cv=D.convertIRToLadder(ir,{compile:C.compileLadder,check:IC});
  check(`A ${nm}: (E4c) ${STRUCT.includes(nm)?'se convierte con validación estructural':'el decompilador lo rechaza por realimentación'}`,STRUCT.includes(nm)?cv.ok:(!cv.ok&&/Feedback/.test(cv.reasons.join())),S.map(s=>s.n+' nodos, memoria: '+s.mem.join('+')).join(' | '));
  const pre=Math.max(0,...ir.program.nodes.map(n=>n.preset|0)),st=steps(pre),base=H.runFirmware(prog,st).join('|');
  const ids=ir.program.nodes.map(n=>n.id);let diff=0,T=20;
  for(let t=0;t<T;t++){const p=ids.slice();for(let i=p.length-1;i>0;i--){const j=(lc()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}const perm={};ids.forEach((id,i)=>perm[id]=p[i]);
    if(H.runFirmware(relabel(prog,perm),st).join('|')!==base)diff++;}
  const single=S.length===1&&S[0].mem.length===1;
  check(`A ${nm}: ${single?'SCC con un solo bloque con memoria → comportamiento INDEPENDIENTE de los ID':'SCC con varios bloques con memoria → comportamiento DEPENDIENTE de los ID'} (${diff}/${T} permutaciones cambian la salida)`,single?diff===0:diff>0);
}
// ── B. Prototipo de transformación estructural (clase: un solo bloque con memoria por SCC) ──
for(const nm of STRUCT){
  const prog=corpus[nm],ir=C.compileFBD(prog),irL=C.compileLadder({rungs:L[nm]});
  const pL={drawflow:C.irToDrawflow(irL.program.nodes).drawflow};
  const pre=Math.max(0,...ir.program.nodes.map(n=>n.preset|0)),st=steps(pre);
  // estructura: mismos SCC, mismo tipo de bloque con memoria, y NINGUNA marca extra dentro del lazo
  check(`B ${nm}: Ladder tiene el mismo SCC (1 bloque con memoria: ${scc(ir)[0].mem[0]} → ${scc(irL)[0]&&scc(irL)[0].mem[0]})`,scc(irL).length===1&&sig(ir)===sig(irL).replace(/"rs"/g,'"sr"').replace(/"sr"/g,'"'+scc(ir)[0].mem[0]+'"')||sig(ir)===sig(irL),sig(ir)+' vs '+sig(irL));
  const f0=H.runFirmware(prog,st),f1=H.runFirmware(pL,st),s0=H.runSim(prog,st),s1=H.runSim(pL,st);
  check(`B ${nm}: Ladder == FBD original en ${f0.length} pasos (de Bruijn de ventana 6 + aleatorio), firmware`,f0.join('|')===f1.join('|'));
  check(`B ${nm}: Ladder == FBD original, simulador`,s0.join('|')===s1.join('|'));
}
// ── C. Con ≥2 bloques con memoria no existe una traducción fija exacta ──
{ const nm='ch08#6',prog=corpus[nm],ir=C.compileFBD(prog),irL=C.compileLadder({rungs:L[nm]});
  const pL={drawflow:C.irToDrawflow(irL.program.nodes).drawflow},st=steps(180000),fl=H.runFirmware(pL,st).join('|');
  const ids=ir.program.nodes.map(n=>n.id);let match=0,T=20;
  for(let t=0;t<T;t++){const p=ids.slice();for(let i=p.length-1;i>0;i--){const j=(lc()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}const perm={};ids.forEach((id,i)=>perm[id]=p[i]);
    if(H.runFirmware(relabel(prog,perm),st).join('|')===fl)match++;}
  check(`C ${nm}: la traducción natural a Ladder coincide con sólo ${match}/${T} reordenamientos de ID del propio FBD (no puede ser exacta para todos)`,match<T,`SCC Ladder: ${JSON.stringify(scc(irL))}`);
}
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
