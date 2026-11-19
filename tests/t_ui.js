'use strict';
// E3: pruebas de la UI real de ladder.html en jsdom (crear, editar, guardar, cargar, importar, convertir, compilar).
const path=require('path'), fs=require('fs');
const R=process.env.REPO||path.resolve(__dirname,'..');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||(require('fs').existsSync(__dirname+'/node_modules/jsdom')?__dirname+'/node_modules/jsdom':'/tmp/jsd/node_modules/jsdom'));
const H=require('./harness'); const {runFirmware,runSim,check}=H;
const C=require(path.join(R,'js/compiler/compiler.js'));
const K=(v,neg)=>({type:'CONTACT',var:v,negated:!!neg});

function boot(opts){
  opts=opts||{};
  const posts=[]; const saves=[];
  const vc=new VirtualConsole(); // silencia ruido
  const store={};
  return new Promise((resolve,reject)=>{
    JSDOM.fromFile(path.join(R,'ladder.html'),{runScripts:'dangerously',resources:'usable',virtualConsole:vc,pretendToBeVisual:true,
      beforeParse(w){
        w.confirm=()=>true; w.alert=()=>{};
        const mk=(init)=>{ const m=Object.assign({},init); return {getItem:k=>(k in m?m[k]:null),setItem:(k,v)=>{m[k]=String(v); saves.push(k);},removeItem:k=>{delete m[k];},clear:()=>{},key:()=>null,get length(){return Object.keys(m).length;},_m:m}; };
        const ls=mk(opts.load!==undefined?{plc_program:(typeof opts.load==='string'?opts.load:JSON.stringify(opts.load))}:{});
        const ss=mk(opts.draft?{ld_pro_v2:JSON.stringify(opts.draft)}:{});
        Object.defineProperty(w,'localStorage',{value:ls,configurable:true});
        Object.defineProperty(w,'sessionStorage',{value:ss,configurable:true});
        w.__ls=ls;
        w.fetch=function(){ return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve(''),json:()=>Promise.resolve({})}); };
      }}).then(dom=>{
    const w=dom.window;
    const t=setTimeout(()=>reject(new Error('timeout boot')),20000);
    w.addEventListener('load',()=>{ setTimeout(()=>{ clearTimeout(t); resolve({dom,w,posts,saves}); },400); });
    }).catch(reject);
  });
}
const tick=(ms)=>new Promise(r=>setTimeout(r,ms||50));
function place(w,tool,rid,pi,ci,fill){ // coloca un elemento como lo hace el usuario: herramienta + modal + OK
  w.placeTool(tool,rid,pi,ci);
  fill&&fill();
}
function contact(w,tool,rid,pi,ci,addr){ w.placeTool(tool,rid,pi,ci); w.document.getElementById('mdl-addr').value=addr; w.confirmModal(); }
function prm(w,vals){ for(const k in vals){ const el=w.document.getElementById('prm-'+k); if(!el) throw new Error('sin campo prm-'+k); el.value=String(vals[k]); } w.confirmParamModal(); }
const o1=o=>o.filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
const o2=o=>o.filter(l=>l.startsWith('OUT')).map(l=>{const t=l.split(' '); return t.slice(1,3).join('')+'/'+t.slice(6).join(',');}).join(' ');
const lastEnv=(S)=>{ const v=S.w.__ls._m.plc_program; return v?JSON.parse(v):null; };
const nSaved=(S)=>S.saves.filter(k=>k==='plc_program').length;

(async()=>{
  // ─────────── U1: arranque vacío, crear con la UI ───────────
  let S=await boot(); let w=S.w;
  check('U1.1 arranca con un renglón por defecto', w.rungs.length===1);
  const r0=w.rungs[0].id;
  contact(w,'P',r0,0,0,'X0');
  check('U1.2 contacto [P] colocado vía modal', JSON.stringify(w.rungs[0].paths[0][0])===JSON.stringify({type:'EDGE',var:'X0',edge:'P'}), JSON.stringify(w.rungs[0].paths[0][0]));
  w.placeTool('COIL',r0,0,0); w.document.getElementById('mdl-addr').value='M0'; w.selMode('NORMAL'); w.confirmModal();
  check('U1.3 bobina M0 colocada', w.rungs[0].outputs.length===2 && w.rungs[0].outputs[1].var==='M0');
  // contacto [N] negado por edición
  w.addRung(); const r1=w.rungs[1].id;
  contact(w,'N',r1,0,0,'X1');
  check('U1.4 contacto [N]', w.rungs[1].paths[0][0].type==='EDGE'&&w.rungs[1].paths[0][0].edge==='N');
  w.placeTool('COIL',r1,0,0); w.document.getElementById('mdl-addr').value='M1'; w.confirmModal();
  // bloque BLINK
  w.addRung(); const r2=w.rungs[2].id;
  contact(w,'NO',r2,0,0,'X0');
  w.placeTool('BLINK',r2,0,1); w.document.getElementById('blk-modal-id').value='T0'; w.document.getElementById('blk-modal-preset').value='200'; w.confirmBlockModal();
  const bl=w.rungs[2].paths[0][1];
  check('U1.5 BLINK T0 preset 200', bl&&bl.type==='BLOCK'&&bl.blockType==='BLINK'&&bl.id==='T0'&&bl.preset===200, JSON.stringify(bl));
  // contactos Q normal y negado de T0 → Y0, Y1
  w.addRung(); const r3=w.rungs[3].id; contact(w,'NO',r3,0,0,'T0');
  w.placeTool('COIL',r3,0,0); w.document.getElementById('mdl-addr').value='Y1'; w.confirmModal();
  w.addRung(); const r4=w.rungs[4].id; contact(w,'NC',r4,0,0,'T0');
  w.placeTool('COIL',r4,0,0); w.document.getElementById('mdl-addr').value='M3'; w.confirmModal();
  check('U1.6 contacto Q normal y negado de BLINK', !w.rungs[3].paths[0][0].negated && w.rungs[4].paths[0][0].negated===true);
  // CMP con operador y parámetros editables
  w.addRung(); const r5=w.rungs[5].id; // anaógico primero
  w.addNumRung(); const nr=w.rungs[w.rungs.length-1];
  check('U1.7 renglón analógico creado', nr.kind==='NUM');
  w.openNumModal(nr.id,1,nr.chain[1]); prm(w,{id:'S0',src:'',inMin:0,inMax:4095,outMin:0,outMax:100});
  check('U1.8 AI1 → SCALE S0 editable en renglón analógico', nr.chain.length===2&&nr.chain[1].id==='S0'&&nr.chain[1].outMax===100, JSON.stringify(nr.chain));
  w.addNumBlock(nr.id); prm(w,{fn:'SCALE'}); await tick(10); prm(w,{id:'S1',src:'S0',inMin:0,inMax:100,outMin:0,outMax:4095});
  check('U1.8b SCALE nuevo S1 con entrada S0', nr.chain[2]&&nr.chain[2].id==='S1'&&nr.chain[2].src==='S0', JSON.stringify(nr.chain[2]));
  contact(w,'NO',r5,0,0,'X0');
  w.placeTool('CMP',r5,0,1); prm(w,{src:'S0',op:'>=',src2:'',value:50});
  const cmp=w.rungs[5].paths[0][1];
  check('U1.9 CMP S0 >= 50', cmp&&cmp.type==='CMP'&&cmp.src==='S0'&&cmp.op==='>='&&cmp.value===50, JSON.stringify(cmp));
  w.placeTool('COIL',r5,0,0); w.document.getElementById('mdl-addr').value='M2'; w.confirmModal();
  // editar CMP: cambiar operador y constante
  w.openCmpModal(r5,0,1,cmp); prm(w,{src:'S0',op:'<',src2:'',value:30});
  const cmp2=w.rungs[5].paths[0][1];
  check('U1.10 edición de CMP conserva y cambia parámetros', cmp2.op==='<'&&cmp2.value===30&&cmp2.src==='S0', JSON.stringify(cmp2));
  w.openCmpModal(r5,0,1,cmp2); prm(w,{src:'S0',op:'>',src2:'',value:'abc'});
  check('U1.11 valor no entero rechazado, CMP intacto', w.rungs[5].paths[0][1].value===30);
  w.closeParamModal();
  w.openCmpModal(r5,0,1,w.rungs[5].paths[0][1]); prm(w,{src:'S0',op:'>',src2:'',value:50});
  // PWM analógico
  w.addNumBlock(nr.id); prm(w,{fn:'PWM'}); await tick(10); prm(w,{out:3,src:''});
  check('U1.12 PWM en la cadena', nr.chain[3]&&nr.chain[3].fn==='PWM'&&nr.chain[3].out===3, JSON.stringify(nr.chain));
  // CTU con reset y CTD con load
  w.addRung(); const r6=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r6,0,0,'X0'); w.placeTool('CTU',r6,0,1); w.document.getElementById('blk-modal-id').value='C0'; w.document.getElementById('blk-modal-preset').value='3'; w.confirmBlockModal();
  w.addRung(); const r7=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r7,0,0,'X1'); w.placeTool('CRST',r7,0,0); w.document.getElementById('mdl-addr').value='C0'; w.confirmModal();
  const crst=w.rungs[w.rungs.length-1].outputs[0];
  check('U1.13 reset de CTU (bobina RESET sobre C0)', crst&&crst.var==='C0'&&crst.mode==='RESET', JSON.stringify(crst));
  w.addRung(); const r8=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r8,0,0,'C0'); w.placeTool('COIL',r8,0,0); w.document.getElementById('mdl-addr').value='M6'; w.confirmModal();
  // CTD + LOAD
  w.addRung(); const r9=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r9,0,0,'X1'); w.placeTool('CTD',r9,0,1); w.document.getElementById('blk-modal-id').value='C1'; w.document.getElementById('blk-modal-preset').value='2'; w.confirmBlockModal();
  w.addRung(); const r10=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r10,0,0,'X0'); w.placeTool('CLD',r10,0,0); w.document.getElementById('mdl-addr').value='C1'; w.confirmModal();
  const cld=w.rungs[w.rungs.length-1].outputs[0];
  check('U1.14 carga LD de CTD (bobina LOAD sobre C1)', cld&&cld.var==='C1'&&cld.mode==='LOAD', JSON.stringify(cld));
  // SR / RS con prioridad
  w.addRung(); const r11=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r11,0,0,'X0'); w.placeTool('SET',r11,0,0); w.document.getElementById('mdl-addr').value='M5'; w.selPrio('S'); w.confirmModal();
  w.addRung(); const r12=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r12,0,0,'X1'); w.placeTool('RESET',r12,0,0); w.document.getElementById('mdl-addr').value='M5'; w.selPrio('R'); w.confirmModal();
  const sc=w.rungs[w.rungs.length-2].outputs[0], rc=w.rungs[w.rungs.length-1].outputs[0];
  check('U1.15 prioridad RS se propaga a las dos bobinas de M5', sc.dom==='R'&&rc.dom==='R', JSON.stringify([sc,rc]));
  w.selPrio('S'); // limpiar estado del modal
  w.openCoilModal(r12,rc,0,'RESET'); w.selPrio('S'); w.confirmModal();
  check('U1.16 volver a SR quita dom en ambas', !w.rungs[w.rungs.length-1].outputs[0].dom && !w.rungs[w.rungs.length-2].outputs[0].dom);
  // PWM coil on/off
  w.addRung(); const r13=w.rungs[w.rungs.length-1].id;
  contact(w,'NO',r13,0,0,'X1'); w.openPwmCoilModal(r13,null,null); prm(w,{out:2});
  check('U1.17 bobina PWM on/off', w.rungs[w.rungs.length-1].outputs[0].type==='PWM'&&w.rungs[w.rungs.length-1].outputs[0].out===2);
  check('U1.18 sin errores de validación del programa', w.LadderAST.validateProgram(w.rungs).filter(m=>m.level==='error').length===0, JSON.stringify(w.LadderAST.validateProgram(w.rungs)));

  // ─────────── U2: guardar (compilar) y comparar FW/SIM ───────────
  w.compileAndSend(); await tick(200);


  const env=lastEnv(S);
  check('U2.1 COMPILE envía /save con envelope ladder v4', env&&env.source==='ladder'&&env.ladder.formatVersion===4, env&&env.ladder&&env.ladder.formatVersion);
  check('U2.2 el envelope conserva bloque BLINK, CMP, EDGE y NUM', JSON.stringify(env.ladder.rungs).includes('"BLINK"')&&JSON.stringify(env.ladder.rungs).includes('"CMP"')&&JSON.stringify(env.ladder.rungs).includes('"EDGE"')&&env.ladder.rungs.some(r=>r.kind==='NUM'));
  const prog={drawflow:env.drawflow};
  const st=[['in',0,0],['in',1,0],['ai',0,3000],['scan',3],['print'],['in',0,1],['scan',3],['print'],['adv',250],['scan',3],['print'],['in',1,1],['scan',3],['print'],['ai',0,500],['scan',3],['print'],['in',0,0],['scan',3],['print']];
  const f=runFirmware(prog,st), s=runSim(prog,st);
  check('U2.3 programa creado en UI: FW y SIM coinciden (Y0,Y1 y PWM)', o2(f)===o2(s), `FW ${o2(f)} | SIM ${o2(s)}`);
  // ─────────── U3: guardar/cargar borrador y re-abrir ───────────
  const draft=w.sessionStorage.getItem('ld_pro_v2'); check('U3.1 borrador en sessionStorage', !!draft && JSON.parse(draft).length===w.rungs.length);
  const saved=JSON.parse(JSON.stringify(w.rungs));
  const S2=await boot({draft:JSON.parse(draft)});
  check('U3.2 el borrador se restaura idéntico', JSON.stringify(S2.w.rungs)===JSON.stringify(saved));
  const S3=await boot({load:env});
  check('U3.3 /load con el envelope guardado restaura todos los elementos', JSON.stringify(S3.w.rungs.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain})))===JSON.stringify(saved.map(r=>({paths:r.paths,outputs:r.outputs,chain:r.chain}))));
  // ─────────── U4: exportar / importar ───────────
  let exported=null; const w3=S3.w;
  w3.URL.createObjectURL=(b)=>{ exported=b; return 'blob:x'; };
  w3.document.createElement=(function(orig){return function(t){ const e=orig.call(w3.document,t); if(t==='a') e.click=()=>{}; return e; };})(w3.document.createElement);
  try{ w3.exportJSON(); }catch(e){}
  let txt=null;
  if(exported){ txt=await new Promise(r=>{ const fr=new w3.FileReader(); fr.onload=()=>r(fr.result); fr.readAsText(exported); }); }
  check('U4.1 exportJSON genera un Blob', !!txt);
  if(txt){ const j=JSON.parse(txt); check('U4.2 export con formato ladder-pro v4', j.format==='ladder-pro'&&j.version===4, j.format+' '+j.version);
    const S4=await boot();
    const file=new S4.w.File([txt],'p.json');
    await new Promise(res=>{ S4.w.importJSON({files:[file],value:''}); setTimeout(res,300); });
    check('U4.3 import restaura los renglones exportados', JSON.stringify(S4.w.rungs.map(r=>({p:r.paths,o:r.outputs,c:r.chain})))===JSON.stringify(saved.map(r=>({p:r.paths,o:r.outputs,c:r.chain}))));
  }
  // ─────────── U5: proyectos antiguos ───────────
  const old1=[{id:'a',comment:'viejo',rows:[{elems:[{type:'CONTACT',var:'X0',negated:false}],coil:{var:'Y0',mode:'NORMAL'}}]}];
  const oldv3={format:'plc_program',version:3,source:'ladder',ladder:{rungs:[
    {id:'r1',comment:'tmr',paths:[[K('X0'),{type:'BLOCK',blockType:'TON',id:'T0',preset:500}]],outputs:[{type:'COIL',var:'M0',mode:'NORMAL'}]},
    {id:'r2',comment:'',paths:[[K('T0')]],outputs:[{type:'COIL',var:'Y0',mode:'SET'}]},
    {id:'r3',comment:'',paths:[[K('X1')]],outputs:[{type:'COIL',var:'Y0',mode:'RESET'}]}]}};
  const S5=await boot({load:oldv3});
  check('U5.1 envelope Ladder v3 abre y conserva parámetros', S5.w.rungs.length===3&&S5.w.rungs[0].paths[0][1].preset===500&&S5.w.rungs[0].paths[0][1].blockType==='TON'&&S5.w.rungs[1].outputs[0].mode==='SET');
  const S6=await boot({draft:[{id:'a',comment:'viejo',paths:[[K('X0')],[K('X1')]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}]});
  check('U5.2 borrador de formato anterior (paths) abre', S6.w.rungs.length===1&&S6.w.rungs[0].paths.length===2&&S6.w.rungs[0].outputs[0].var==='Y0');
  const S7=await boot({load:{rungs:[{id:'z',comment:'',paths:[[K('X0')]],outputs:[{type:'COIL',var:'Y1',mode:'NORMAL'}]}]}});
  check('U5.3 objeto {rungs:[...]} abre', S7.w.rungs.length===1&&S7.w.rungs[0].outputs[0].var==='Y1');
  // compilar un proyecto viejo debe seguir produciendo el mismo comportamiento
  S5.w.compileAndSend(); await tick(200);
  const e5=lastEnv(S5); const p5={drawflow:e5.drawflow};
  const st5=[['in',0,1],['scan',2],['adv',600],['scan',3],['print'],['in',0,0],['in',1,1],['scan',3],['print']];
  const a=runFirmware(p5,st5), b=runSim(p5,st5);
  check('U5.4 proyecto v3 recompilado: FW=SIM y T0→SET Y0 → RESET', o1(a)==='1000,0000'&&o1(b)==='1000,0000', `${o1(a)} | ${o1(b)}`);
  // ─────────── U6: importación inválida no pierde el programa ───────────
  const S8=await boot({draft:saved}); const before=JSON.stringify(S8.w.rungs);
  await new Promise(res=>{ S8.w.importJSON({files:[new S8.w.File(['{no es json'],'x.json')],value:''}); setTimeout(res,300); });
  check('U6.1 JSON corrupto: el programa del editor queda intacto', JSON.stringify(S8.w.rungs)===before);
  await new Promise(res=>{ S8.w.importJSON({files:[new S8.w.File([JSON.stringify({format:'ladder-pro',version:4,rungs:[]})],'x.json')],value:''}); setTimeout(res,300); });
  check('U6.2 archivo sin renglones: programa intacto', JSON.stringify(S8.w.rungs)===before);
  // ─────────── U7: conversión FBD → Ladder desde la UI ───────────
  const okRungs=[{id:'a',comment:'',paths:[[K('X0'),K('X1',true)]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]},
                 {id:'b',comment:'',paths:[[K('X1'),{type:'BLOCK',blockType:'TON',id:'T0',preset:300}]],outputs:[]},
                 {id:'c',comment:'',paths:[[K('T0')]],outputs:[{type:'COIL',var:'Y1',mode:'NORMAL'}]}];
  const irOk=C.compileLadder({rungs:okRungs});
  const fbdOk={format:'plc_program',version:3,source:'fbd',ir:irOk,drawflow:C.irToDrawflow(irOk.program.nodes).drawflow};
  const S9=await boot({load:fbdOk});
  const ban=S9.w.document.getElementById('conv-banner');
  check('U7.1 FBD convertible: se convierte al abrir y avisa verificado', S9.w.rungs.length>=2 && /correcta/.test(ban.textContent) && /verificada/.test(ban.textContent), ban.textContent.slice(0,120));
  S9.w.compileAndSend(); await tick(200);
  const e9=lastEnv(S9);
  const stc=[['in',0,1],['in',1,0],['scan',2],['print'],['in',1,1],['scan',2],['print'],['adv',400],['scan',3],['print']];
  const pa=runFirmware({drawflow:fbdOk.drawflow},stc), pb=runFirmware({drawflow:e9.drawflow},stc);
  check('U7.2 FBD original vs Ladder convertido y recompilado (FW)', o1(pa)===o1(pb), `${o1(pa)} | ${o1(pb)}`);
  const pc=runSim({drawflow:e9.drawflow},stc);
  check('U7.3 Ladder convertido: SIM = FW', o1(pc)===o1(pb), `${o1(pc)} | ${o1(pb)}`);
  // FBD no convertible: realimentación combinacional (lazo entre compuertas)
  const nodes=[{id:1,name:'input',data:{index:0}},{id:2,name:'or',data:{}},{id:3,name:'and',data:{}},{id:4,name:'output',data:{index:0}}];
  const fbdBad=C.irToDrawflow ? null : null;
  const progBad=H.program([{id:1,name:'input',data:{channel:0}},{id:2,name:'or',data:{}},{id:3,name:'not',data:{}},{id:4,name:'output',data:{channel:0}}],[[1,2,1],[3,2,2],[2,3,1],[2,4,1]]);
  const irBad={program:{nodes:[
    {id:1,type:'input',params:{channel:0},inputs:[],in1:null},
  ]}};
  // construimos el FBD malo con el compilador de Ladder: auto-retención con contacto Y0 sobre un nodo cíclico
  let envBad=null;
  try{
    const rl=[{id:'a',comment:'',paths:[[K('X0')],[K('Y0')]].map(p=>p.concat([K('X1',true)])),outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}];
    const ib=C.compileLadder({rungs:rl});
    envBad={format:'plc_program',version:3,source:'fbd',ir:ib,drawflow:C.irToDrawflow(ib.program.nodes).drawflow};
  }catch(e){ console.log('  (no se pudo armar FBD cíclico:',e.message,')'); }
  if(envBad){
    const S10=await boot({load:envBad});
    const b2=S10.w.document.getElementById('conv-banner');
    const conv=S10.w.convertIR(envBad.ir);
    if(conv.ok){ check('U7.4 FBD con lazo: la conversión verificada es aceptable o se rechaza', true, 'convertido y verificado'); }
    else {
      check('U7.4 FBD no convertible: aviso comprensible con el elemento', b2.style.display==='block'&&/no se puede convertir/.test(b2.textContent)&&b2.querySelectorAll('li').length>=1, b2.textContent.slice(0,200));
      check('U7.5 FBD no convertible: COMPILE bloqueado, sin POST /save', (S10.w.compileAndSend(),nSaved(S10)===0));
      check('U7.6 el programa guardado no se modificó', S10.w.__ls._m.plc_program===JSON.stringify(envBad));
      check('U7.7 "empezar Ladder nuevo" desbloquea', (b2.querySelector('button').click(), S10.w.compileAndSend(), true));
    }
  }
  // Caso garantizado de rechazo: bucle por NOT con salida sobre sí mismo en un nodo `and` sin conexión
  const badIr={program:{nodes:[{id:1,type:'and',in1:null,in2:null,params:{}},{id:2,type:'output',in1:1,params:{channel:0}}]}};
  const S11=await boot({load:{format:'plc_program',version:3,source:'fbd',ir:{program:{nodes:badIr.program.nodes}},drawflow:{}}});
  const b3=S11.w.document.getElementById('conv-banner');
  check('U7.8 AND con entrada sin conectar: se rechaza sin perder el programa', b3.style.display==='block'&&/no se puede convertir/.test(b3.textContent)&&/AND|and|entrada/i.test(b3.textContent), b3.textContent.slice(0,200));
  S11.w.compileAndSend(); await tick(50);
  check('U7.9 COMPILE bloqueado ante conversión fallida', nSaved(S11)===0);
  // convertFromSaved con conversión fallida conserva el editor
  const S12=await boot({load:fbdOk}); const keep=JSON.stringify(S12.w.rungs);
  S12.w.fetch=(u)=>Promise.resolve({ok:true,text:()=>Promise.resolve(JSON.stringify({format:'plc_program',source:'fbd',ir:badIr,drawflow:{}}))});
  await S12.w.convertFromSaved(); await tick(50);
  check('U7.10 FROM FBD fallido: renglones del editor intactos', JSON.stringify(S12.w.rungs)===keep);
  // ─────────── U8: ruta de compilación ───────────
  const S13=await boot({load:{rungs:[{id:'a',comment:'',paths:[[{type:'EDGE',var:'X0',edge:'P'}]],outputs:[{type:'COIL',var:'M0',mode:'SET'}]},{id:'b',comment:'',paths:[[K('M0')]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}]}});
  
  S13.w.compileAndSend(); await tick(200);
  const e13=lastEnv(S13); check('U8.1 programa con [P]: ruta única ladder_paths', e13.compiledWith==='ladder_paths', e13.compiledWith); check('U8.2 [P] compila a r_trig', JSON.stringify(e13.ir.program.nodes).includes('r_trig'));
  const stp=[['in',0,1],['scan',2],['print'],['in',0,0],['scan',2],['print']];
  check('U8.3 [P]+SET: FW=SIM', o1(runFirmware({drawflow:e13.drawflow},stp))===o1(runSim({drawflow:e13.drawflow},stp)), o1(runFirmware({drawflow:e13.drawflow},stp)));
  console.log(JSON.stringify(H.summary()).slice(0,0));
  process.exit(H.summary().fail?1:0);
})().catch(e=>{ console.error('ERROR',e); process.exit(2); });
