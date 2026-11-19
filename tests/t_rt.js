'use strict';
const path=require('path'), fs=require('fs'), vm=require('vm');
const R=process.env.REPO||require('path').resolve(__dirname,'..');
const H=require('./harness'); const {program,runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const LP=require(path.join(R,'js/compiler/ladder_program.js')); global.LadderProgram=LP;
const C=require(path.join(R,'js/compiler/compiler.js')); global.PlcCompiler=C;
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
// _rungs_to_ladder_ast tal como está en ladder.html (se extrae el código real)
const html=fs.readFileSync(path.join(R,'ladder.html'),'utf8');
const i0=html.indexOf('function _rungs_to_ladder_ast'); 
let depth=0,i=html.indexOf('{',i0),j=i; for(;j<html.length;j++){if(html[j]=='{')depth++; else if(html[j]=='}'){depth--; if(!depth)break;}}
const ctx={LadderProgram:LP,console}; vm.createContext(ctx); vm.runInContext(html.slice(i0,j+1)+';this.f=_rungs_to_ladder_ast;',ctx);
const toAst=ctx.f;
const o1=o=>o.filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
function rt(name,fbd,st,{blocks=false}={}){
  let ir,dec;
  try{ ir=C.compileFBD(fbd); dec=D.decompileIRToLadder(ir); }catch(e){check(`${name}: decompilar`,false,String(e.message).slice(0,150));return;}
  if(!dec||!dec.rungs||!dec.rungs.length){check(`${name}: decompilar`,false,'sin rungs: '+JSON.stringify(dec&&dec.analysis).slice(0,150));return;}
  const ref=[runFirmware(fbd,st),runSim(fbd,st)];
  // ruta A: compileLadder (paths)  /  ruta B: AST (solo sin bloques, igual que ladder.html)
  const routes=[['paths',()=>C.compileLadder({rungs:dec.rungs.map(r=>({id:r.id,comment:r.comment,paths:r.paths,outputs:r.outputs}))})]];
  const needsPaths=dec.rungs.some(r=>r.kind==='NUM'||(r.paths||[]).some(p=>p.some(e=>e.type!=='CONTACT'))||(r.outputs||[]).some(c=>c.dom||c.type==='PWM'||/^[CT]/.test(c.var||'')));
  if(!blocks&&!needsPaths) routes.push(['ast',()=>C.compileLadderAST(toAst(dec.rungs))]);
  for(const [rn,f] of routes){
    let ir2; try{ir2=f();}catch(e){check(`${name} [ruta ${rn}]`,false,'compila: '+String(e.message).slice(0,140));continue;}
    const p2={drawflow:(ir2.drawflow||C.irToDrawflow(ir2.program.nodes).drawflow)};
    const b=[runFirmware(p2,st),runSim(p2,st)];
    check(`${name} [ruta ${rn}] FBD == FBD->Ladder->IR (FW y SIM)`, ref[0].join()===b[0].join()&&ref[1].join()===b[1].join()&&b[0].join()===b[1].join(), o1(ref[0])+'  vs  '+o1(b[0])+' / '+o1(b[1]));
  }
}
const gate=(t)=>program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:t},{id:4,name:'output1'}],[[1,3],[2,3],[3,4]]);
const tt=[];[[0,0],[0,1],[1,0],[1,1]].forEach(([a,b])=>tt.push(['in',0,a],['in',1,b],['scan',3],['print']));
['and','or','xor'].forEach(t=>rt('RT '+t.toUpperCase(),gate(t),tt));
// NOT
rt('RT NOT',program([{id:1,name:'input1'},{id:2,name:'not'},{id:3,name:'output1'}],[[1,2],[2,3]]),[['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['print']]);
// Arranque/paro con SR (S=IN1, R=IN2)
const sr=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
rt('RT SR arranque/paro',gate('sr'),sr);
rt('RT RS',gate('rs'),[['in',0,1],['in',1,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,0],['in',0,1],['scan',3],['print']]);
// puertos invertidos: R es input1, S input2
rt('RT SR puertos invertidos (S=IN2,R=IN1)',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'sr'},{id:4,name:'output1'}],[[1,3,2],[2,3,1],[3,4]]),sr);
// Temporizador / contador (con bloques: solo ruta paths)
rt('RT TON',program([{id:1,name:'input1'},{id:2,name:'ton',data:{time:'100'}},{id:3,name:'output1'}],[[1,2],[2,3]]),[['in',0,1],['scan',5],['print'],['scan',7],['print'],['in',0,0],['scan',2],['print']],{blocks:true});
// ---- No convertibles: deben rechazarse (null + advertencias), nunca convertirse mal ----
function noConv(name,fbd){
  let ir=C.compileFBD(fbd), dec=D.decompileIRToLadder(ir), an=D.analyzeIR(ir);
  check(name+': el decompilador lo rechaza (nivel 3) en vez de mal-convertirlo',dec===null&&an.convertible===false,(an.warnings||[]).slice(0,2).join(' | ').slice(0,150));
}
noConv('NC lazo combinacional OR/AND',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'or'},{id:4,name:'not'},{id:5,name:'and'},{id:6,name:'output1'}],[[1,3,1],[5,3,2],[2,4],[3,5,1],[4,5,2],[5,6]]));
noConv('NC CMP sobre fuente booleana',program([{id:1,name:'input1'},{id:2,name:'cmp',data:{op:'>',value:'0'}},{id:3,name:'output1'}],[[1,2],[2,3]]));
noConv('NC PWM sin entrada',program([{id:1,name:'pwm',data:{out:'0'}}],[]));
// Ahora SÍ convertibles (E2): flancos, reset de CTU, CMP
const e2=[['in',0,1],['scan',2],['print'],['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['print']];
rt('RT R_TRIG',program([{id:1,name:'input1'},{id:2,name:'r_trig'},{id:3,name:'output1'}],[[1,2],[2,3]]),e2,{blocks:true});
rt('RT F_TRIG',program([{id:1,name:'input1'},{id:2,name:'f_trig'},{id:3,name:'output1'}],[[1,2],[2,3]]),e2,{blocks:true});
rt('RT CTU con RESET',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'ctu',data:{value:'2'}},{id:4,name:'output1'}],[[1,3,1],[2,3,2],[3,4]]),
  [['in',0,1],['scan',2],['in',0,0],['scan',2],['in',0,1],['scan',2],['print'],['in',0,0],['in',1,1],['scan',2],['print']],{blocks:true});
rt('RT CMP (AI1>100)',program([{id:1,name:'analog1'},{id:2,name:'cmp',data:{op:'>',value:'100'}},{id:3,name:'output1'}],[[1,2],[2,3]]),
  [['ai',0,50],['scan',2],['print'],['ai',0,500],['scan',2],['print']],{blocks:true});
// CTU solo con CU (sin reset) y TON alimentado por OR: sí convertibles
rt('RT CTU sin reset',program([{id:1,name:'input1'},{id:2,name:'ctu',data:{value:'2'}},{id:3,name:'output1'}],[[1,2,1],[2,3]]),(()=>{const p=[['in',0,1],['scan',2],['in',0,0],['scan',2]];return [...p,['print'],...p,['print']];})(),{blocks:true});
rt('RT TON habilitado por OR(IN1,IN2)',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'or'},{id:4,name:'ton',data:{time:'100'}},{id:5,name:'output1'}],[[1,3,1],[2,3,2],[3,4],[4,5]]),
  [['in',0,1],['scan',5],['print'],['scan',12],['print'],['in',0,0],['in',1,1],['scan',5],['print'],['scan',12],['print'],['in',1,0],['scan',2],['print']],{blocks:true});
rt('RT TON + contacto: Y=TON AND IN2',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'ton',data:{time:'50'}},{id:4,name:'and'},{id:5,name:'output1'}],[[1,3],[3,4,1],[2,4,2],[4,5]]),
  [['in',0,1],['in',1,1],['scan',3],['print'],['scan',8],['print'],['in',1,0],['scan',2],['print']],{blocks:true});
// dos salidas, mismo SR en dos lugares
rt('RT dos salidas (OUT1=SR, OUT2=NOT SR)',program([{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'sr'},{id:4,name:'not'},{id:5,name:'output1'},{id:6,name:'output2'}],[[1,3,1],[2,3,2],[3,5],[3,4],[4,6]]),sr);
// dos salidas con enclavamiento mutuo
const {pass,fail}=H.summary(); console.log(`\nTOTAL pass=${pass} fail=${fail}`);
