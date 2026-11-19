'use strict';
const path=require('path'), fs=require('fs'), vm=require('vm');
const R=process.env.REPO||require('path').resolve(__dirname,'..');
const H=require('./harness'); const {runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const LP=require(path.join(R,'js/compiler/ladder_program.js')); global.LadderProgram=LP;
const C=require(path.join(R,'js/compiler/compiler.js')); global.PlcCompiler=C;
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const o1=o=>o.filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
const K=(v,neg)=>({type:'CONTACT',var:v,negated:!!neg});
const BL=(bt,id,preset)=>({type:'BLOCK',blockType:bt,id,preset});
const co=(v,mode)=>({type:'COIL',var:v,mode:mode||'NORMAL'});
const rung=(id,paths,outs)=>({id,comment:'',paths,outputs:outs});
function run(rungs){ const ir=C.compileLadder({rungs}); return {ir,p:{drawflow:C.irToDrawflow(ir.program.nodes).drawflow}}; }
function expectSeq(name,rungs,st,exp){
  let r; try{r=run(rungs);}catch(e){check(name,false,'compila: '+e.message);return null;}
  const f=runFirmware(r.p,st), s=runSim(r.p,st);
  check(name+' [FW y SIM]', o1(f)===exp&&o1(s)===exp, `esperado ${exp} | FW ${o1(f)} | SIM ${o1(s)}`);
  return r;
}
const arr=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
// 1. Autorretención clásica con contacto Y0
const L1=[rung('r1',[[K('X0')],[K('Y0')]].map(p=>p.concat([K('X1',true)])),[co('Y0')])];
expectSeq('LAD1 autorretención Y0=(X0+Y0)·/X1 (contacto Y lee la bobina)',L1,arr,'1000,1000,0000,0000');
// 2. SET/RESET sobre Y
expectSeq('LAD2 SET/RESET sobre Y0 (SET X0, RESET X1)',[rung('a',[[K('X0')]],[co('Y0','SET')]),rung('b',[[K('X1')]],[co('Y0','RESET')])],arr,'1000,1000,0000,0000');
// 3. Contacto Y0 usado por otra salida (Y1 = Y0)
expectSeq('LAD3 Y1 copia a Y0 mediante contacto Y0',[rung('a',[[K('X0')]],[co('Y0')]),rung('b',[[K('Y0')]],[co('Y1')])],
  [['in',0,1],['scan',2],['print'],['in',0,0],['scan',2],['print']],'1100,0000');
// 4. Bobina M normal sigue a la condición (antes se retenía para siempre)
expectSeq('LAD4 bobina M0 normal sigue a X0 (se apaga al soltar)',[rung('a',[[K('X0')]],[co('M0')]),rung('b',[[K('M0')]],[co('Y0')])],
  [['in',0,1],['scan',2],['print'],['in',0,0],['scan',2],['print']],'1000,0000');
// 5. M0 SET/RESET + Y0 lee M0
expectSeq('LAD5 M0 SET/RESET, Y0=M0',[rung('a',[[K('X0')]],[co('M0','SET')]),rung('b',[[K('X1')]],[co('M0','RESET')]),rung('c',[[K('M0')]],[co('Y0')])],arr,'1000,1000,0000,0000');
// 6. Dos SET en ramas distintas y un RESET
expectSeq('LAD6 SET desde X0 o X1 (dos rungs), RESET con X0·X1',[rung('a',[[K('X0')]],[co('Y0','SET')]),rung('b',[[K('X1')]],[co('Y0','SET')]),rung('c',[[K('X0'),K('X1')]],[co('Y0','RESET')])],
  [['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print'],['in',0,1],['in',1,1],['scan',3],['print']],'1000,1000,1000');
// 7. TON + contacto T0
expectSeq('LAD7 TON(60ms) con X0, Y0 = T0',[rung('a',[[K('X0'),BL('TON','T0',60)]],[co('M1')]),rung('b',[[K('T0')]],[co('Y0')])],
  [['in',0,1],['scan',3],['print'],['scan',10],['print'],['in',0,0],['scan',2],['print']],'0000,1000,0000');
// 8. índices fuera de la placa -> error claro (antes mapeaban a input2/output1 en silencio)
for(const [nm,rg] of [['X5',[rung('a',[[K('X5')]],[co('Y0')])]],['Y9',[rung('a',[[K('X0')]],[co('Y9')])]]]){
  let msg=''; try{C.compileLadder({rungs:rg});}catch(e){msg=e.message;}
  check(`LAD8 ${nm} fuera de la placa => error de compilación explícito`,/no existe/.test(msg),msg);
}
// 9. Doble bobina normal => advertencia
{ const ir=C.compileLadder({rungs:[rung('a',[[K('X0')]],[co('Y0')]),rung('b',[[K('X1')]],[co('Y0')])]});
  check('LAD9 doble bobina Y0 genera advertencia COIL_CONFLICT',(ir.meta.warnings||[]).some(w=>w.code==='COIL_CONFLICT'),JSON.stringify(ir.meta.warnings).slice(0,120)); }
// 10. Orden de compilación idéntico a runtime (FW/SIM) para programas Ladder
{ const r=run(L1); const f=runFirmware(r.p,[['order']])[0].trim().split(/\s+/).map(Number);
  const irIds=r.ir.order.map(i=>r.ir.program.nodes[i].id);
  check('LAD10 ir.order del compilador == execOrder del firmware',JSON.stringify(f)===JSON.stringify(irIds),f.join()+' vs '+irIds.join()); }
// 11. Round trip Ladder -> IR -> decompilar -> Ladder -> IR (equivalencia de comportamiento)
function ladRT(name,rungs,st){
  let a,b; try{a=run(rungs); const dec=D.decompileIRToLadder(a.ir); if(!dec) throw new Error('no convertible: '+JSON.stringify((D.analyzeIR(a.ir).warnings||[]).slice(0,2))); b=run(dec.rungs.map(r=>({id:r.id,comment:'',paths:r.paths,outputs:r.outputs})));}catch(e){check(name,false,String(e.message).slice(0,200));return;}
  const ra=[runFirmware(a.p,st),runSim(a.p,st)], rb=[runFirmware(b.p,st),runSim(b.p,st)];
  check(name+' Ladder == Ladder->IR->Ladder->IR (FW y SIM)',o1(ra[0])===o1(rb[0])&&o1(ra[1])===o1(rb[1])&&o1(rb[0])===o1(rb[1]),o1(ra[0])+' vs '+o1(rb[0]));
}
{const a=run(L1);const cv=D.convertIRToLadder(a.ir);check('LRT1 autorretención por contacto de salida: la conversión inversa se RECHAZA (criterio conservador de realimentación) y avisa',!cv.ok&&/Feedback loop/.test(cv.reasons.join()),cv.reasons.join().slice(0,100));}
ladRT('LRT2 SET/RESET Y',[rung('a',[[K('X0')]],[co('Y0','SET')]),rung('b',[[K('X1')]],[co('Y0','RESET')])],arr);
ladRT('LRT3 M0 SET/RESET + Y0=M0',[rung('a',[[K('X0')]],[co('M0','SET')]),rung('b',[[K('X1')]],[co('M0','RESET')]),rung('c',[[K('M0')]],[co('Y0')])],arr);
ladRT('LRT4 M0 normal + Y0=M0',[rung('a',[[K('X0')]],[co('M0')]),rung('b',[[K('M0')]],[co('Y0')])],[['in',0,1],['scan',2],['print'],['in',0,0],['scan',2],['print']]);
// 12. irToDrawflow: outMax=0 explícito se conserva (antes el runtime lo trataba como "sin valor" => 100)
{ const nodes=[{id:1,type:'analog1',in1:null,in2:null,outputs:[],preset:0,value:0,op:'>',outIdx:0},{id:2,type:'scale',in1:0,in2:null,outputs:[],preset:0,value:0,op:'>',outIdx:0,scaleInMin:0,scaleInMax:4095,scaleOutMin:100,scaleOutMax:0},{id:3,type:'output1',in1:1,in2:null,outputs:[],preset:0,value:0,op:'>',outIdx:0}];
  const p={drawflow:C.irToDrawflow(nodes).drawflow};
  const st=[['ai',0,4095],['scan',2],['node',2]]; const f=runFirmware(p,st), s=runSim(p,st);
  check('irToDrawflow SCALE 100->0 (outMax=0) llega íntegro al runtime [FW y SIM]',f[0].endsWith('int=0')&&s[0].endsWith('int=0'),f[0]+' | '+s[0]); }
const {pass,fail}=H.summary(); console.log(`\nTOTAL pass=${pass} fail=${fail}`);
