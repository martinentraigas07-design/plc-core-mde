'use strict';
// Revisión E4b/2 — corrección SET c / RESET NOT c (compiler.js: latch 'sr' → 'rs' cuando R es NOT de S).
//  (a) comportamiento scan a scan (estado inicial, SET, retención, RESET, simultaneidad, prioridad) en FW y SIM;
//  (b) comparación contra el compilador ANTERIOR a la corrección sobre cientos de programas: sólo cambian los que usan el idioma;
//  (c) el firmware sigue interpretando como NT_PREV el SR(S=X,R=NOT X) del FBD (no se tocó el motor).
const path=require('path'),fs=require('fs'),vm=require('vm'),os=require('os'),{spawnSync}=require('child_process');
const R=process.env.REPO||path.resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const IC=require(path.join(R,'js/compiler/ir_check.js'));
const H=require('./harness'); const {check}=H;
console.warn=()=>{};console.info=()=>{};
// compilador anterior: el mismo archivo sin el bloque de la corrección
let src=fs.readFileSync(path.join(R,'js/compiler/compiler.js'),'utf8');
const a=src.indexOf("      // El firmware y el simulador reinterpretan SR(S=X, R=NOT X)"), b=src.indexOf("    });",a);
check('SR.0 se localizó el bloque de la corrección en compiler.js',a>0&&b>a);
const OLD=(()=>{const m={exports:{}};const ctx={module:m,exports:m.exports,window:global,console,PlcSymbolTable:global.PlcSymbolTable,LadderProgram:global.LadderProgram,self:global};
  vm.createContext(ctx);vm.runInContext(src.slice(0,a)+src.slice(b),ctx);return m.exports.compileLadder?m.exports:ctx.PlcCompiler||ctx.window.PlcCompiler;})();
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
const co=(v,m,dom)=>{const c={type:'COIL',var:v,mode:m||'NORMAL'};if(dom)c.dom='R';return c;};
const rg=(id,paths,outs)=>({id,comment:'',paths,outputs:outs||[]});
const prog=(cc,rungs)=>({drawflow:C.irToDrawflow(cc.compileLadder({rungs}).program.nodes).drawflow});
const Y=o=>o.filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
const run=(p,st)=>[Y(H.runFirmware(p,st)),Y(H.runSim(p,st))];
// ── (a) comportamiento ──
const SEQ=[['scan',1],['print'],['in',0,1],['scan',1],['print'],['scan',3],['print'],['in',0,0],['scan',1],['print'],['scan',3],['print'],['in',0,1],['scan',1],['print'],['in',0,0],['in',0,1],['scan',1],['print']];
// Y0 = SET X0 / RESET /X0 : debe seguir a X0 en el mismo scan (inicial 0, sube, retiene, baja, reentra)
const P1=[rg('a',[[K('X0')]],[co('Y0','SET')]),rg('b',[[K('X0',1)]],[co('Y0','RESET')])];
const exp1='0000,1000,1000,0000,0000,1000,1000';
let nw=run(prog(C,P1),SEQ), od=run(prog(OLD,P1),SEQ);
check('SR.1 nuevo: SET X0 / RESET /X0 sobre Y0 sigue a X0 sin retardo (FW y SIM)',nw[0]===exp1&&nw[1]===exp1,nw.join(' | ').slice(0,120));
check('SR.1b control: el compilador anterior sí tenía 1 scan de retardo (se reproduce el defecto)',od[0]!==exp1,od[0]);
// estado inicial con X0=1 desde el primer scan
const SEQ0=[['in',0,1],['scan',1],['print'],['scan',2],['print'],['in',0,0],['scan',1],['print']];
nw=run(prog(C,P1),SEQ0); check('SR.2 estado inicial: con X0=1 desde el arranque Y0=1 en el primer scan (FW y SIM)',nw[0]==='1000,1000,0000'&&nw[1]===nw[0],nw[0]);
// vía marca M0 y lectura posterior
const P3=[rg('a',[[K('X0')]],[co('M0','SET')]),rg('b',[[K('X0',1)]],[co('M0','RESET')]),rg('c',[[K('M0')]],[co('Y0')]),rg('d',[[K('M0',1)]],[co('Y1')])];
nw=run(prog(C,P3),SEQ); check('SR.3 sobre marca M0: Y0=M0 y Y1=/M0 complementarias scan a scan (FW y SIM)',nw[0]==='0100,1000,1000,0100,0100,1000,1000'&&nw[1]===nw[0],nw[0]);
// prioridad: con dom R el latch ya era RS (no cambia); con set/reset simultáneos distintos (X0 vs X1) la prioridad se mantiene
const PR=(dom)=>[rg('a',[[K('X0')]],[co('Y0','SET',dom)]),rg('b',[[K('X1')]],[co('Y0','RESET',dom)])];
const SIMUL=[['in',0,1],['in',1,1],['scan',2],['print'],['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['print'],['in',1,0],['scan',2],['print']];
nw=run(prog(C,PR(false)),SIMUL); check('SR.4 SR (SET gana) con SET y RESET simultáneos: 1,0,0... según prioridad (FW y SIM)',nw[0]==='1000,0000,1000,1000'&&nw[1]===nw[0],nw[0]);
nw=run(prog(C,PR(true)),SIMUL);  check('SR.5 RS (RESET gana) con SET y RESET simultáneos (FW y SIM)',nw[0]==='0000,0000,0000,1000'&&nw[1]===nw[0],nw[0]);
od=[run(prog(OLD,PR(false)),SIMUL),run(prog(OLD,PR(true)),SIMUL)];
check('SR.6 la prioridad SR/RS es idéntica con y sin la corrección',JSON.stringify(od[0])===JSON.stringify(run(prog(C,PR(false)),SIMUL))&&JSON.stringify(od[1])===JSON.stringify(run(prog(C,PR(true)),SIMUL)));
// SET compuesto: no es el idioma (R no es NOT exacto de S) → sigue siendo un SR normal
const P7=[rg('a',[[K('X0'),K('X1')]],[co('Y0','SET')]),rg('b',[[K('X0',1)],[K('X1',1)]],[co('Y0','RESET')])];
const SEQ7=[['in',0,1],['in',1,1],['scan',1],['print'],['in',1,0],['scan',1],['print'],['in',1,1],['scan',1],['print']];
nw=run(prog(C,P7),SEQ7); check('SR.7 SET X0·X1 / RESET /X0+/X1 (complementario pero no idioma): comportamiento de latch intacto',nw[0]==='1000,0000,1000'&&nw[1]===nw[0]&&JSON.stringify(nw)===JSON.stringify(run(prog(OLD,P7),SEQ7)),nw[0]);
// ── (b) comparación IR nuevo vs anterior sobre muchos programas ──
const progs=[];
const corpus=[];
for(const c of ['ch01_03','ch04','ch05','ch06','ch07','ch08','ch10','ch11_5box']){const f=path.join(os.tmpdir(),'e4s_'+process.pid+'_'+c+'.json');
  spawnSync('node',[path.join(__dirname,'manual',c+'.js')],{env:Object.assign({},process.env,{E4_CORPUS_OUT:f})});
  JSON.parse(fs.readFileSync(f)).forEach(e=>corpus.push(e.prog)); fs.unlinkSync(f);}
for(const p of corpus){ try{const ir=C.compileFBD(p);const cv=D.convertIRToLadder(ir,{compile:C.compileLadder,check:IC});if(cv.ok)progs.push(cv.rungs);}catch(e){} }
const nManual=progs.length;
const lcg=s=>()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
for(let seed=1;seed<=1500;seed++){const r=lcg(seed*7919),pick=a=>a[(r()*a.length)|0];const rungs=[];
  for(let q=0;q<2+((r()*4)|0);q++){const paths=[];for(let p=0;p<1+((r()*2)|0);p++){const pa=[];for(let e=0;e<1+((r()*2)|0);e++)pa.push(K(pick(['X0','X1','M0','M1','Y0']),r()<0.4));paths.push(pa);}
    rungs.push(rg('r'+q,paths,[co(pick(['Y0','Y1','M0','M1']),pick(['NORMAL','SET','RESET','SET','RESET']),r()<0.3?'R':undefined)]));}
  progs.push(rungs);}
let same=0,diffIdiom=0,diffOther=0,total=0,otherEx=null;
for(const rungs of progs){ let a1,b1;try{a1=C.compileLadder({rungs});b1=OLD.compileLadder({rungs});}catch(e){continue;} total++;
  const A=a1.program.nodes,B=b1.program.nodes; if(JSON.stringify(A)===JSON.stringify(B)){same++;continue;}
  // ¿la única diferencia son nodos 'rs' (nuevo) que antes eran 'sr' con in2 = NOT(in1)?
  let onlyIdiom=A.length===B.length;
  if(onlyIdiom) for(let i=0;i<A.length;i++){ if(JSON.stringify(A[i])===JSON.stringify(B[i]))continue;
    const idiom=B[i].type==='sr'&&A[i].type==='rs'&&B[i].in2!=null&&B[i].in1!=null&&B[i].in2>=0&&B[B[i].in2].type==='not'&&B[B[i].in2].in1===B[i].in1;
    const o1=Object.assign({},A[i],{type:'x'}),o2=Object.assign({},B[i],{type:'x'}); if(!idiom||JSON.stringify(o1)!==JSON.stringify(o2)){onlyIdiom=false;break;} }
  if(onlyIdiom)diffIdiom++; else {diffOther++;otherEx=otherEx||JSON.stringify(rungs).slice(0,200);} }
console.log(`# programas comparados: ${total} (${nManual} convertidos del manual + aleatorios); idénticos=${same}; difieren sólo por el idioma=${diffIdiom}; difieren por otra causa=${diffOther}`);
check('SR.8 el IR nuevo es idéntico al anterior salvo en los latches con el idioma SET c / RESET NOT c',diffOther===0&&same>1000,otherEx||'');
check('SR.9 hubo casos con el idioma entre los aleatorios (la comparación los alcanza)',diffIdiom>0,String(diffIdiom));
// comportamiento de los que difieren: sólo mejora (nuevo == referencia sin retardo); los demás idénticos por IR → idénticos por construcción
// ── (c) el motor no se tocó: SR(S=X,R=NOT X) en FBD sigue siendo un registro de 1 scan ──
const fbd=H.program([{id:1,name:'input1',data:{}},{id:2,name:'not',data:{}},{id:3,name:'sr',data:{}},{id:4,name:'output1',data:{}}],[[1,2],[1,3,1],[2,3,2],[3,4]]);
const o=run(fbd,[['in',0,1],['scan',1],['print'],['scan',1],['print'],['in',0,0],['scan',1],['print'],['scan',1],['print']]);
check('SR.10 motor intacto: FBD SR(S=X,R=NOT X) sigue siendo registro de 1 scan, Q = X del scan anterior (FW y SIM)',o[0]==='0000,1000,1000,0000'&&o[1]===o[0],o[0]);
// FBD SR/RS ordinarios: no cambian (la corrección vive sólo en compileLadder)
const sr=H.program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'sr'},{id:4,name:'rs'},{id:5,name:'output1'},{id:6,name:'output2'}].map(n=>Object.assign({data:{}},n)),[[1,3,1],[2,3,2],[1,4,1],[2,4,2],[3,5],[4,6]]);
const o2=run(sr,SIMUL); check('SR.11 FBD SR y RS ordinarios con S y R simultáneos: SR gana SET, RS gana RESET (FW y SIM)',o2[0]==='1000,0000,1000,1100'&&o2[1]===o2[0],o2[0]);
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
