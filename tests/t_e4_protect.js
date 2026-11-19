'use strict';
// E4.5 — Protección de programas: una conversión rechazada o un archivo corrupto NO puede sobrescribir
//   (a) el programa abierto en el editor, (b) el guardado en el navegador (sessionStorage = borrador),
//   (c) el persistido en el PLC (aquí, el almacenamiento del simulador real de la página: localStorage 'plc_program'),
// y no debe ejecutarse /save. Se registra TODA llamada de red de la página.
const path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const H=require('./harness'); const {check}=H;
const {boot,tick,contact,coil,importText}=require('./ui_boot');
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
const N=(id,name,data)=>({id,name,data:data||{}});
const fbdEnv=(prog)=>{ const ir=C.compileFBD(prog); return {format:'plc_program',version:3,source:'fbd',ir,drawflow:prog.drawflow}; };
const snap=S=>JSON.stringify({rungs:S.w.rungs,saved:S.saved(),draft:S.draft(),saves:S.saves(),protect:!!S.w._protect});
const good=[{id:'g1',comment:'prog bueno',paths:[[K('X0'),K('X1',1)]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}];
const goodEnv=JSON.stringify({format:'plc_program',version:3,source:'ladder',ladder:{rungs:good}});

// FBD NO convertible (realimentación) y FBD con AND sin conectar
const loopProg=H.program([N(1,'input1'),N(2,'input2'),N(3,'or'),N(4,'not'),N(5,'and'),N(6,'output1')],[[1,3,1],[6,3,2],[2,4],[3,5,1],[4,5,2],[5,6]]);
const andOpen=H.program([N(1,'input1'),N(2,'and'),N(3,'output1')],[[1,2,1],[2,3]]);
(async()=>{
 // ───────── A. FBD guardado en el PLC y NO convertible, al abrir el editor ─────────
 for(const [nm,prog,pat] of [['realimentación',loopProg,/realimentación|Feedback|lazo/i],['AND con entrada sin conectar',andOpen,/AND|entrada/i]]){
   const saved=JSON.stringify(fbdEnv(prog));
   const draft=JSON.stringify(good);
   const S=await boot({ls:{plc_program:saved},ss:{ld_pro_v2:draft}});
   const banner=S.w.document.getElementById('conv-banner');
   check(`A[${nm}] aviso comprensible con la estructura que impide convertir`,banner.style.display==='block'&&/no se puede convertir/.test(banner.textContent)&&pat.test(banner.textContent),banner.textContent.slice(60,230));
   check(`A[${nm}] el PLC conserva exactamente el programa FBD (byte a byte)`,S.saved()===saved);
   check(`A[${nm}] COMPILE bloqueado y sin /save`,(()=>{S.w.compileAndSend();return S.saves()===0&&S.saved()===saved;})());
   check(`A[${nm}] el editor queda protegido (flag) y no hay escrituras de localStorage`,!!S.w._protect&&S.lsLog.filter(k=>k==='plc_program').length===0);
   // otras vías de escritura también bloqueadas: botón/función de envío y atajos
   check(`A[${nm}] ninguna llamada POST salió de la página`,S.calls.filter(c=>c.method==='POST').length===0,JSON.stringify(S.calls.slice(0,4)));
   // desbloqueo explícito: sólo entonces compila
   banner.querySelector('button').click(); S.w.compileAndSend(); await tick(250);
   check(`A[${nm}] sólo tras "Empezar un Ladder nuevo" se permite guardar`,S.saves()===1&&S.saved()!==saved);
 }
 // ───────── B. FBD convertible: no escribe nada al abrir ─────────
 { const okProg=H.program([N(1,'input1'),N(2,'input2'),N(3,'and'),N(4,'output1')],[[1,3,1],[2,3,2],[3,4]]);
   const saved=JSON.stringify(fbdEnv(okProg)); const S=await boot({ls:{plc_program:saved}});
   check('B convertible: se convierte y se verifica, sin tocar lo guardado ni enviar nada',S.saved()===saved&&S.saves()===0&&/verificada/.test(S.w.document.getElementById('conv-banner').textContent)); }
 // ───────── C. FROM FBD con conversión rechazada: editor intacto ─────────
 { const S=await boot({ls:{plc_program:goodEnv}}); const before=snap(S);
   S.w.localStorage.setItem('plc_program',JSON.stringify(fbdEnv(loopProg))); const savedFbd=S.saved(); S.lsLog.length=0;
   await S.w.convertFromSaved(); await tick(100);
   check('C FROM FBD rechazado: renglones del editor intactos',JSON.stringify(S.w.rungs)===JSON.stringify(JSON.parse(before).rungs));
   check('C FROM FBD rechazado: programa guardado intacto y sin /save',S.saved()===savedFbd&&S.saves()===0);
   check('C FROM FBD rechazado: aviso con el motivo',/no se puede convertir/.test(S.w.document.getElementById('conv-banner').textContent)); }
 // ───────── D. Importación de archivos corruptos o inválidos ─────────
 const BAD=[
  ['JSON truncado','{"format":"ladder-pro","version":4,"rungs":[{"id":"a","pa'],
  ['no es JSON','esto no es un programa'],
  ['vacío',''],
  ['objeto sin renglones','{"format":"ladder-pro","version":4}'],
  ['renglones vacíos','{"format":"ladder-pro","version":4,"rungs":[]}'],
  ['renglones nulos','{"rungs":[null,null]}'],
  ['renglones no-objeto','{"rungs":["a",5,true]}'],
  ['paths con basura','{"rungs":[{"id":"a","paths":"x","outputs":5}]}'],
  ['número','12345'],
  ['array de números','[1,2,3]'],
  ['null','null'],
 ];
 for(const [nm,txt] of BAD){
   const S=await boot({ls:{plc_program:goodEnv},ss:{ld_pro_v2:JSON.stringify(good)}});
   const b=snap(S), rungsB=JSON.stringify(S.w.rungs);
   await importText(S,txt);
   // si el archivo se aceptó, debe haber producido un programa válido (no destruir el actual con basura)
   const accepted=JSON.stringify(S.w.rungs)!==rungsB;
   check(`D[${nm}] import corrupto: el programa del editor queda intacto`,!accepted,accepted?JSON.stringify(S.w.rungs).slice(0,120):'');
   S.w.compileAndSend(); await tick(200);
   if(!accepted) check(`D[${nm}] import rechazado: lo guardado en el PLC no cambia (sin /save espurio salvo compilación explícita del programa intacto)`,JSON.parse(S.saved()).ladder.rungs[0].id==='g1');
   check(`D[${nm}] el borrador del navegador conserva un programa utilizable`,(()=>{try{const d=JSON.parse(S.draft());return Array.isArray(d)&&d.length>0;}catch(e){return false;}})());
 }
 // un import corrupto NUNCA debe, por sí mismo, ejecutar /save ni escribir el programa del PLC
 { const S=await boot({ls:{plc_program:goodEnv}}); await importText(S,'{"rungs":[null]}'); await importText(S,'basura'); await importText(S,'{"rungs":[]}');
   check('D importaciones corruptas encadenadas: cero /save y programa del PLC idéntico',S.saves()===0&&S.saved()===goodEnv); }
 // ───────── E. Programa guardado ilegible / formato desconocido ─────────
 for(const [nm,txt] of [['JSON dañado','{"format":"plc_program","ir":{"progr'],['formato desconocido','{"format":"otro_formato","datos":[1,2,3]}'],['envelope sin rungs ni ir','{"format":"plc_program","version":3,"source":"fbd"}']]){
   const S=await boot({ls:{plc_program:txt}});
   check(`E[${nm}] COMPILE bloqueado: no se sobrescribe lo guardado`,(()=>{S.w.compileAndSend();return S.saves()===0&&S.saved()===txt;})(),S.w.document.getElementById('conv-banner').textContent.slice(0,120));
   check(`E[${nm}] aviso visible`,S.w.document.getElementById('conv-banner').style.display==='block');
 }
 // ───────── F. Programa abierto + conversión fallida no se pierde al seguir editando ─────────
 { const saved=JSON.stringify(fbdEnv(loopProg)); const S=await boot({ls:{plc_program:saved}});
   const rid=S.w.rungs[0].id; contact(S.w,'NO',rid,0,1,'X1'); await tick(50);
   check('F se puede seguir editando el Ladder nuevo en memoria sin tocar el PLC',S.saves()===0&&S.saved()===saved); }
 // ───────── G. Control negativo: sin protección, un compile normal SÍ escribe (la prueba detecta /save) ─────────
 { const S=await boot({ls:{plc_program:goodEnv}}); S.w.compileAndSend(); await tick(250);
   check('G control: un COMPILE legítimo sí ejecuta /save (la instrumentación funciona)',S.saves()===1); }
 const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
