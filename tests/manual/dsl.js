'use strict';
// DSL para traducir los ejemplos del manual a programas Drawflow ejecutables.
//   P([['i1','input1'],['s','sr'],['o','output1']], ['i1>s','n>s:2'])
// alias -> id correlativo (en el orden declarado). 'a>b' = puerto 1, 'a>b:2' = puerto 2.
const path=require('path');
const H=require('../harness');
const R=process.env.REPO||require('path').resolve(__dirname,'../..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
function P(decl,links){
  const ids={},nodes=decl.map(([a,t,d],i)=>{ids[a]=i+1;return {id:i+1,name:t,data:d||{}};});
  const ls=links.map(l=>{const m=/^(\w+)>(\w+)(?::(\d))?$/.exec(l);if(!m)throw new Error('link '+l);if(!(m[1] in ids)||!(m[2] in ids))throw new Error('alias '+l);return [ids[m[1]],ids[m[2]],m[3]?+m[3]:1];});
  const p=H.program(nodes,ls);p.__ids=ids;
  if(process.env.E4_CORPUS_OUT){(global.__corpus=global.__corpus||[]).push({ch:process.env.CH||'x',prog:p});}
  return p;
}
const dig=l=>l.split(' ').slice(1,5).join('');       // 'OUT 1 0 0 0 ...' -> '1000'
const both=(prog,steps)=>({fw:H.runFirmware(prog,steps),sim:H.runSim(prog,steps)});
// run(prog, steps, expected[]) : verifica FW y SIM contra la lista esperada de estados de salida (uno por 'print')
function expectOut(name,prog,steps,expected,extra){
  let r;try{r=both(prog,steps);}catch(e){H.check(name,false,'ERR '+e.message);return null;}
  const f=r.fw.filter(l=>l.startsWith('OUT')).map(dig),s=r.sim.filter(l=>l.startsWith('OUT')).map(dig);
  const ok=JSON.stringify(f)===JSON.stringify(expected)&&JSON.stringify(s)===JSON.stringify(expected);
  H.check(name,ok,ok?f.join(','):`esperado ${expected.join(',')} | FW ${f.join(',')} | SIM ${s.join(',')}`);
  return r;
}
// Equivalencia FBD -> Ladder -> IR (solo si el decompilador lo declara convertible)
function ladderEquiv(name,prog,steps,blocks){
  const ir=C.compileFBD(prog),an=D.analyzeIR(ir);
  if(!an.convertible){H.check(name+' [Ladder]',true,'NO convertible a Ladder (nivel '+an.level+'): '+an.warnings.filter(w=>!/Node \d+ \(analog1/.test(w)).slice(0,1).join('').slice(0,90));return 'nc';}
  const IC=require(path.join(R,'js/compiler/ir_check.js'));const dec=D.decompileIRToLadder(ir,{compile:C.compileLadder,check:IC});
  if(!dec){H.check(name+' [Ladder]',true,'NO convertible a Ladder (validación estructural/equivalencia): rechazado');return 'nc';}
  const rungs=dec.rungs.map(r=>({id:r.id,comment:'',paths:r.paths,outputs:r.outputs}));
  const ir2=C.compileLadder({rungs});const p2={drawflow:C.irToDrawflow(ir2.program.nodes).drawflow};
  const a=both(prog,steps),b=both(p2,steps);
  const ok=a.fw.join()===b.fw.join()&&a.sim.join()===b.sim.join()&&b.fw.join()===b.sim.join();
  H.check(name+' [Ladder] FBD == FBD->Ladder->IR (FW y SIM)',ok,ok?'equivalente':a.fw.filter(l=>l.startsWith('OUT')).map(dig).join(',')+' vs '+b.fw.filter(l=>l.startsWith('OUT')).map(dig).join(','));
  return ok?'ok':'diff';
}
module.exports={P,expectOut,ladderEquiv,both,dig,H,C,D,check:H.check};

// ---------- verificación de ejemplos del manual ----------
const fs=require('fs');
const findings=[];
const step=(ins,scans=3)=>[...Object.entries(ins).map(([k,v])=>['in',+k,v]),['scan',scans],['print']];
const seq=(...l)=>l.reduce((a,b)=>a.concat(b),[]);
function runOut(prog,steps){const r=both(prog,steps);return {f:r.fw.filter(l=>l.startsWith('OUT')).map(dig),s:r.sim.filter(l=>l.startsWith('OUT')).map(dig),raw:r};}
// manualEx: comprueba el FBD "tal cual está dibujado" contra la tabla del manual; si no coincide registra HALLAZGO
// y exige que la versión corregida (corrected) sí la cumpla.
function manualEx(id,title,asDrawn,steps,expected,corrected,note){
  const a=runOut(asDrawn,steps);
  const okA=JSON.stringify(a.f)===JSON.stringify(expected)&&JSON.stringify(a.s)===JSON.stringify(expected);
  const same=JSON.stringify(a.f)===JSON.stringify(a.s);
  let status='OK';
  if(!same){H.check(`Ej ${id} ${title}: FW y SIM coinciden`,false,'FW '+a.f.join(',')+' | SIM '+a.s.join(','));status='FW!=SIM';}
  else if(okA){H.check(`Ej ${id} ${title}: el FBD del manual cumple su tabla`,true,a.f.join(','));}
  else{
    status='DEFECTO_MANUAL';
    H.check(`Ej ${id} ${title}: [HALLAZGO] el FBD tal como está dibujado NO cumple la tabla (confirmado en FW y SIM)`,true,`esperado ${expected.join(',')} | obtenido ${a.f.join(',')}`);
    if(corrected){const c=runOut(corrected,steps);const okC=JSON.stringify(c.f)===JSON.stringify(expected)&&JSON.stringify(c.s)===JSON.stringify(expected);
      H.check(`Ej ${id} ${title}: versión corregida cumple la tabla (FW y SIM)`,okC,okC?c.f.join(','):`esperado ${expected.join(',')} | FW ${c.f.join(',')} | SIM ${c.s.join(',')}`);}
  }
  findings.push({id,title,status,expected,obtained:a.f,note:note||''});
  return status;
}
function ladderNote(id,prog,steps){let r;try{r=ladderEquiv('Ej '+id,prog,steps);}catch(e){H.check('Ej '+id+' [Ladder]',false,'ERR '+String(e.message).slice(0,100));r='err';}
  const f=findings.find(x=>x.id===id);if(f)f.ladder=r;return r;}
process.on('exit',()=>{try{if(process.env.E4_CORPUS_OUT&&global.__corpus)fs.writeFileSync(process.env.E4_CORPUS_OUT,JSON.stringify(global.__corpus));}catch(e){}
  try{fs.mkdirSync(__dirname+'/resultados',{recursive:true});fs.writeFileSync(__dirname+'/resultados/hallazgos_cap_'+(process.env.CH||'x')+'.json',JSON.stringify(findings,null,1));}catch(e){}});
Object.assign(module.exports,{step,seq,manualEx,ladderNote,findings,runOut});
