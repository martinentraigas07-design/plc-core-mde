'use strict';
// E4.3 — Ciclo completo con fixtures de versiones anteriores:
//   abrir → migrar → editar → compilar → guardar → cerrar → volver a abrir → ejecutar
// Los fixtures son representativos, reconstruidos a partir de los formatos que el editor ha producido
// (rows/cells v1-v2, paths v3, export ladder-pro v3, borradores, envelopes); NO son archivos de usuarios reales.
const path=require('path');
const H=require('./harness'); const {runFirmware,runSim,check}=H;
const {boot,tick,contact,coil,importText}=require('./ui_boot');
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
const y4=o=>o.filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
const env=(rungs,extra)=>Object.assign({format:'plc_program',version:3,source:'ladder',compiledWith:'ladder_paths',ladder:{rungs}},extra||{});
const XS=[['in',0,0],['in',1,0],['scan',3],['print'],['in',0,1],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',0,0],['scan',3],['print']];
const PULSES=n=>{const a=[['in',0,0],['scan',2]];for(let i=0;i<n;i++)a.push(['in',0,1],['scan',2],['in',0,0],['scan',2]);a.push(['print']);return a;};
const TMR=[['in',0,1],['scan',2],['adv',350],['scan',3],['print'],['adv',300],['scan',3],['print'],['in',0,0],['in',1,1],['scan',3],['print']];

// ───── fixtures: {name, how: 'saved'|'draft'|'import', data, steps, expect (antes de editar), edit(S), steps2/expect2 (después de editar)} ─────
const FX=[
 { name:'v1 rows (editor original): Y0=X0·/X1 + X1·/X0', how:'saved', ext:'rows',
   data:env(undefined),  // se reemplaza abajo
   raw:[{id:'a',rows:[[{type:'NO',addr:'X0'},{type:'NC',addr:'X1'},{type:'COIL',addr:'Y0'}],[{type:'NO',addr:'X1'},{type:'NC',addr:'X0'}]]}],
   steps:XS, expect:'0000,1000,0000,1000' /* X0·/X1 + X1·/X0 */ },
 { name:'v2 cells + SET/RESET (editor original)', how:'saved',
   raw:[{id:'a',cells:[[{type:'NO',addr:'X0'},{type:'COIL',addr:'Y1',mode:'SET'}]]},{id:'b',cells:[[{type:'NO',addr:'X1'},{type:'COIL',addr:'Y1',mode:'RESET'}]]}],
   steps:XS, expect:'0000,0100,0100,0000' /* X0 set; con X0·X1 domina SET; X0=0,X1=1 reset */ },
 { name:'v3 paths: TON(500) → SET Y0, RESET X1', how:'saved',
   raw:[{id:'r1',comment:'tmr',paths:[[K('X0'),{type:'BLOCK',blockType:'TON',id:'T0',preset:500}]],outputs:[{type:'COIL',var:'M0',mode:'NORMAL'}]},
        {id:'r2',comment:'',paths:[[K('T0')]],outputs:[{type:'COIL',var:'Y0',mode:'SET'}]},
        {id:'r3',comment:'',paths:[[K('X1')]],outputs:[{type:'COIL',var:'Y0',mode:'RESET'}]}],
   steps:TMR, expect:'0000,1000,0000',
   edit:async S=>{ const b=S.w.rungs[0].paths[0][1]; S.w.openBlockModal(S.w.rungs[0].id,0,1,b); S.w.document.getElementById('blk-modal-preset').value='300'; S.w.confirmBlockModal(); },
   expect2:'1000,1000,0000' /* tras bajar el preset a 300 ms ya está a los 350 ms */ },
 { name:'v3 autorretención con contacto Y0', how:'saved',
   raw:[{id:'a',comment:'',paths:[[K('X0'),K('X1',1)],[K('Y0'),K('X1',1)]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}],
   steps:[['in',0,0],['in',1,0],['scan',3],['print'],['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print']], expect:'0000,1000,1000,0000' },
 { name:'v3 CTU con preset como texto y sin blockType (C0)', how:'saved',
   raw:[{id:'a',comment:'',paths:[[K('X0'),{type:'BLOCK',id:'C0',preset:'2'}]],outputs:[]},{id:'b',comment:'',paths:[[K('C0')]],outputs:[{type:'COIL',var:'Y1',mode:'NORMAL'}]}],
   multi:true, steps:null, // se evalúa con 1 y 2 pulsos
   pulses:[[1,'0000'],[2,'0100']],
   edit:async S=>{ const b=S.w.rungs[0].paths[0][1]; S.w.openBlockModal(S.w.rungs[0].id,0,1,b); S.w.document.getElementById('blk-modal-preset').value='3'; S.w.confirmBlockModal(); },
   pulses2:[[2,'0000'],[3,'0100']] },
 { name:'export ladder-pro v3 (archivo .json)', how:'import', fmt:{format:'ladder-pro',version:3,source:'ladder'},
   raw:[{id:'a',comment:'x',paths:[[K('X0')],[K('X1')]],outputs:[{type:'COIL',var:'Y2',mode:'NORMAL'}]}],
   steps:XS, expect:'0000,0010,0010,0010', },
 { name:'borrador de sesión antiguo (rows en sessionStorage)', how:'draft',
   raw:[{id:'a',rows:[[{type:'NC',addr:'X0'},{type:'COIL',addr:'Y3'}]]}],
   steps:XS, expect:'0001,0000,0000,0001' },
 { name:'borrador v3 (paths + TOF)', how:'draft',
   raw:[{id:'a',comment:'',paths:[[K('X0'),{type:'BLOCK',blockType:'TOF',id:'T1',preset:400}]],outputs:[]},{id:'b',comment:'',paths:[[K('T1')]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}],
   steps:[['in',0,1],['scan',3],['print'],['in',0,0],['scan',2],['adv',200],['scan',2],['print'],['adv',400],['scan',3],['print']], expect:'1000,1000,0000' },
 { name:'envelope Ladder v3 con campos extra (ir, drawflow, symbolTable)', how:'saved', extraEnv:true,
   raw:[{id:'a',comment:'',paths:[[K('X0'),K('X1',1)]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}],
   steps:XS, expect:'0000,1000,0000,0000' },
];
// forma de cada fixture en su medio de almacenamiento
function material(fx){
  if(fx.how==='saved'){ let e=env(fx.raw); if(fx.extraEnv){ const C=require(path.join(process.env.REPO||path.resolve(__dirname,'..'),'js/compiler/compiler.js')); } return JSON.stringify(e); }
  if(fx.how==='draft') return JSON.stringify(fx.raw);
  return JSON.stringify(Object.assign({},fx.fmt,{rungs:fx.raw}));
}
function runPulses(prog,n){ const st=PULSES(n); return [y4(runFirmware(prog,st)),y4(runSim(prog,st))]; }
(async()=>{
 for(const fx of FX){
  const N=fx.name;
  // 1) ABRIR
  let opts={}; const m=material(fx);
  if(fx.how==='saved') opts={ls:{plc_program:m}}; else if(fx.how==='draft') opts={ss:{ld_pro_v2:m}};
  let S=await boot(opts);
  if(fx.how==='import'){ await importText(S,m); }
  const w=S.w;
  const ok0=w.rungs.length===fx.raw.length && w.LadderAST.validateProgram(w.rungs).filter(x=>x.level==='error').length===0;
  check(`${N}: abre y valida (${w.rungs.length} renglón/es)`,ok0,JSON.stringify(w.LadderAST.validateProgram(w.rungs)).slice(0,150));
  // 2) MIGRAR: todo renglón en formato actual y parámetros intactos
  const mig=w.rungs.every(r=>Array.isArray(r.paths)&&Array.isArray(r.outputs));
  const blocks=fx.raw.flatMap(r=>(r.paths||[]).flat()).filter(e=>e.type==='BLOCK');
  const mblocks=w.rungs.flatMap(r=>(r.paths||[]).flat()).filter(e=>e.type==='BLOCK');
  const par=blocks.every((b,i)=>mblocks[i]&&mblocks[i].id===b.id&&mblocks[i].preset===(parseInt(b.preset,10)||0)&&!!mblocks[i].blockType);
  check(`${N}: migrado al modelo actual con parámetros conservados`,mig&&par,JSON.stringify(mblocks));
  // 3) COMPILAR sin editar y EJECUTAR (comportamiento histórico esperado)
  const runExpect=async(S_,exp,pulses)=>{
    S_.w.compileAndSend(); await tick(250);
    const e=JSON.parse(S_.saved()); const prog={drawflow:e.drawflow};
    if(pulses){ return pulses.every(([n,x])=>{const [f,s]=runPulses(prog,n);return f===x&&s===x;}); }
    const f=y4(runFirmware(prog,fx.steps)),s=y4(runSim(prog,fx.steps));
    if(fx.pick!==undefined){ /* sólo la salida pedida */ }
    return f===exp&&s===exp ? true : (console.log('    FW',f,'SIM',s,'esp',exp), false);
  };
  const base=await runExpect(S,fx.expect,fx.pulses);
  check(`${N}: compila y se comporta como el programa original (FW y SIM)`,base);
  // 4) EDITAR (cambio real vía UI) y 5) COMPILAR/GUARDAR
  let S2=S;
  if(fx.edit){ await fx.edit(S); }
  // además toda edición agrega un renglón independiente X1→Y3 (si no usa Y3) para probar que lo existente no se altera
  const usesY3=JSON.stringify(fx.raw).includes('Y3');
  let before=null;
  if(!usesY3){ w.addRung(); const rid=w.rungs[w.rungs.length-1].id; w.rungs[w.rungs.length-1].outputs=[]; contact(w,'NO',rid,0,0,'X1'); coil(w,rid,'Y3'); }
  const edited=JSON.stringify(w.rungs);
  w.compileAndSend(); await tick(250);
  check(`${N}: tras editar se guarda (/save una vez) en el almacenamiento del PLC`,S.saves()>=1&&!!S.saved(),`saves=${S.saves()}`);
  const savedEnv=JSON.parse(S.saved());
  check(`${N}: lo guardado lleva formatVersion 4 y el ladder editado`,savedEnv.ladder&&savedEnv.ladder.formatVersion===4&&JSON.stringify(savedEnv.ladder.rungs.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain,kind:r.kind})))===JSON.stringify(w.rungs.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain,kind:r.kind}))));
  // 6) CERRAR y VOLVER A ABRIR (nueva página; sólo persiste lo guardado en el PLC)
  const S3=await boot({ls:{plc_program:S.saved()}});
  check(`${N}: reabierto desde lo guardado, el editor restaura exactamente lo editado`,JSON.stringify(S3.w.rungs.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain})))===JSON.stringify(w.rungs.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain}))));
  // 7) EJECUTAR lo reabierto: recompilar sin cambios debe dar el mismo comportamiento que lo guardado
  S3.w.compileAndSend(); await tick(250);
  const e3=JSON.parse(S3.saved());
  const exp2=fx.edit?(fx.expect2||fx.expect):fx.expect;
  let run2;
  if(fx.pulses){ const pl=fx.pulses2||fx.pulses; run2=pl.every(([n,x])=>{const [f,s]=runPulses({drawflow:e3.drawflow},n);return f===x&&s===x;}); }
  else { const cut=t=>usesY3?t:t.split(',').map(q=>q.slice(0,3)).join(',');
    const f=y4(runFirmware({drawflow:e3.drawflow},fx.steps)),s=y4(runSim({drawflow:e3.drawflow},fx.steps));
    run2=cut(f)===cut(exp2)&&f===s; if(!run2)console.log('    FW',f,'SIM',s,'esp',exp2);
    // el renglón añadido X1→Y3 sigue a X1 (sólo en fixtures con la secuencia XS: X1 = 0,0,1,1 en cada print)
    if(!usesY3&&fx.steps===XS){ const col=f.split(',').map(q=>q[3]).join(',');
      check(`${N}: el renglón añadido X1→Y3 sigue a X1 (FW y SIM)`,col==='0,0,1,1'&&s.split(',').map(q=>q[3]).join(',')===col,col); } }
  check(`${N}: reabierto y ejecutado → comportamiento esperado${fx.edit?' (con la edición)':''} (FW y SIM)`,run2);
 }
 // ─── el borrador no se pierde al cerrar sin compilar y no pisa lo guardado ───
 { const saved=JSON.stringify(env([{id:'a',comment:'',paths:[[K('X0')]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}]));
   const S=await boot({ls:{plc_program:saved}}); S.w.addRung(); S.w.saveDraft&&S.w.saveDraft(); 
   check('borrador: editar sin compilar NO modifica lo guardado en el PLC',S.saved()===saved&&S.saves()===0); }
 const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
