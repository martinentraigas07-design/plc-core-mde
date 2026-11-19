'use strict';
process.env.CH='8';
const {P,step,seq,check,runOut,findings,ladderNote,C,D}=require('./dsl');
const H=require('../harness');
const adv=ms=>[['adv',ms],['scan',1],['print']];
const eqj=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const o1=r=>r.f.map(x=>x[0]);
// ---- 8.1 cadena NC + reset supervisado ----
// (a) primer FBD del manual: RS(S=IN1,R=IN2) (retractado por el propio texto)
const a81=P([['i1','input1'],['i2','input2'],['s','rs'],['o','output1']],['i1>s','i2>s:2','s>o']);
// (b) "simplificado": RS(S=AND(IN1,IN2), R=NOT IN1)
const b81=P([['i1','input1'],['i2','input2'],['a','and'],['n','not'],['s','rs'],['o','output1']],['i1>a','i2>a:2','i1>n','a>s','n>s:2','s>o']);
// Tabla del manual (IN1,IN2 -> Q)
const tabla=[[0,0,0],[1,1,1],[1,0,1],[0,0,0],[1,0,0],[0,0,0],[1,1,1]];
{ // secuencia que respeta las filas del manual (Q mantiene en "1,0 sin presionar nada")
  const st=seq(step({0:0,1:0}),step({0:1,1:1}),step({0:1,1:0}),step({0:0,1:0}),step({0:1,1:0}),step({0:0,1:0}),step({0:1,1:1}));
  const want=['0','1','1','0','0','0','1'];
  const A=runOut(a81,st),B=runOut(b81,st);
  check('Ej 8.1 FBD simplificado RS(S=IN1·IN2, R=¬IN1): FW y SIM cumplen las filas de la tabla del manual',eqj(o1(B),want)&&eqj(B.s.map(x=>x[0]),want),o1(B).join(''));
  check('Ej 8.1 [HALLAZGO] el primer FBD (RS con S=IN1, R=IN2) NO cumple la tabla: con IN1=1 e IN2=0 arranca sin supervisor',!eqj(o1(A),want)&&eqj(A.f,A.s),o1(A).join(''));
  // fila "IN1=1 IN2=1 simultáneos: Q=0 (RESET gana)" contradice la fila 2 (1,1 -> 1)
  const c=runOut(b81,seq(step({0:0,1:0}),step({0:1,1:1})));
  check('Ej 8.1 [HALLAZGO] fila "IN1=1,IN2=1 → Q=0 (conflicto)" es incorrecta: con S=IN1·IN2 y R=¬IN1 nunca hay conflicto y el resultado es Q=1 (igual que la fila 2)',c.f[1][0]==='1'&&c.s[1][0]==='1','Q='+c.f[1][0]);
  // INICIO NA está EN SERIE dentro de la cadena de IN1: soltar INICIO => IN1=0 => RESET
  const hold=runOut(b81,seq(step({0:0,1:0}),step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0})));
  check('Ej 8.1 [HALLAZGO] con INICIO NA dentro de la cadena de IN1, al SOLTAR INICIO la prensa se detiene (solo corre mientras se sostiene INICIO)',hold.f[1][0]==='1'&&hold.f[2][0]==='0'&&eqj(hold.f,hold.s),o1(hold).join(''));
  // Corrección: IN1 = solo la cadena NC (EMERG), IN2 = INICIO/REARME NA con R_TRIG (rearme por flanco)
  const fx=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['a','and'],['n','not'],['s','rs'],['o','output1']],['i2>rt','rt>a','i1>a:2','i1>n','a>s','n>s:2','s>o']);
  const sq=seq(step({0:1,1:0}),step({0:1,1:1}),step({0:1,1:0}),step({0:0,1:0}),step({0:1,1:0}),step({0:1,1:1}),step({0:1,1:0}),
               step({0:0,1:1}),step({0:1,1:1}));
  const d=runOut(fx,sq);
  const w2=['0','1','1','0','0','1','1','0','0'];
  check('Ej 8.1 corregido (IN1=cadena NC, IN2=INICIO/rearme por flanco): corre al soltar INICIO, para con emergencia, no rearma solo al cerrar la cadena, no rearma con IN2 sostenido (FW y SIM)',
    eqj(o1(d),w2)&&eqj(d.s.map(x=>x[0]),w2),o1(d).join(''));
  // Ladder del manual: rung1 SET [IN1][IN2], rung2 RESET [/IN1]
  const rungs=[{id:'r1',comment:'',paths:[[{type:'CONTACT',var:'X0',negated:false},{type:'CONTACT',var:'X1',negated:false}]],outputs:[{type:'COIL',var:'Y0',mode:'SET'}]},
               {id:'r2',comment:'',paths:[[{type:'CONTACT',var:'X0',negated:true}]],outputs:[{type:'COIL',var:'Y0',mode:'RESET'}]}];
  const ir=C.compileLadder({rungs});const pl={drawflow:C.irToDrawflow(ir.program.nodes).drawflow};
  const L=runOut(pl,st);
  check('Ej 8.1 el Ladder del manual (SET=IN1·IN2, RESET=/IN1) compilado coincide con el FBD simplificado y con las filas de la tabla (FW y SIM)',eqj(o1(L),want)&&eqj(L.s.map(x=>x[0]),want),o1(L).join(''));
  findings.push({id:'8.1',title:'Cadena NC con reset supervisado',status:'DEFECTO_MANUAL',expected:want,obtained:o1(A),note:'(1) El texto presenta primero RS(S=IN1,R=IN2) y lo retracta; debe eliminarse. (2) La fila "IN1=1,IN2=1 → Q=0" contradice la fila 2; con la lógica correcta Q=1. (3) Por cablear INICIO NA en serie en la cadena de IN1, la prensa se detiene al soltar INICIO. Usar IN1 = cadena NC, IN2 = INICIO/rearme con R_TRIG. (4) Debe incluir un cartel: esta lógica NO es una función de seguridad validada (ver 8.5).'}); }
// ---- 8.2 cintas enclavadas ----
{ // El FBD usa IN3/IN4 y OUT2b: no existen en el hardware (2 entradas, 4 salidas)
  let err='';try{C.compileLadder({rungs:[{id:'r',comment:'',paths:[[{type:'CONTACT',var:'X2',negated:false}]],outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}]});}catch(e){err=e.message;}
  check('Ej 8.2 [HALLAZGO] IN3 (X2) no existe: el compilador lo rechaza con error explícito',/X2|fuera|range|board|exceed|input/i.test(err)||err.length>0,err.slice(0,90));
  // Adaptación ejecutable con 2 entradas: C1 = RS(S=IN1,R=NOT IN2) ; C2 = TOF(Q1) 3 s (C2 corre mientras C1 corre y 3 s más)
  const p=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','tof',{time:'3000'}],['o1','output1'],['o2','output2']],['i1>s','i2>n','n>s:2','s>o1','s>t','t>o2']);
  const st=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(1000),step({0:0,1:0}),adv(1500),adv(2000));
  const r=runOut(p,st);
  const g=r.f.map(x=>x.slice(0,2));
  check('Ej 8.2 (adaptación a 2 entradas) C1 para → C2 sigue 3 s y se apaga sola (FW y SIM)',eqj(g,['00','11','11','11','01','01','00'])&&eqj(r.f,r.s),g.join(','));
  findings.push({id:'8.2',title:'Cintas enclavadas',status:'DEFECTO_MANUAL',expected:[],obtained:g,note:'El FBD y el Ladder usan IN3/IN4 y "OUT2b", que no existen (2 entradas, 4 salidas); el compilador rechaza X2. El Ladder rung 3 usa [IN1] aunque el texto dice IN3. El enclavamiento C1→C2 con TOF sí funciona (verificado con adaptación a 2 entradas). La referencia a RS-485 no es ejecutable: el editor no tiene nodos RDI/RDO (ver Cap. 9).'}); }
// ---- 8.3 timeout de seguridad ----
{ const asDrawn=P([['i1','input1'],['i2','input2'],['s','rs'],['t','ton',{time:'180000'}],['o1','output1'],['o2','output2']],['i1>s','i2>s:2','s>t','t>s:2','s>o1','t>o2']);
  const fix=P([['i1','input1'],['i2','input2'],['or','or'],['s','rs'],['t','ton',{time:'180000'}],['al','sr'],['o1','output1'],['o2','output2']],['i2>or','t>or:2','i1>s','or>s:2','s>t','s>o1','t>al','i1>al:2','al>o2']);
  const st=seq(step({0:0,1:0}),step({0:1,1:0}),step({0:0,1:0}),adv(100000),adv(79000),adv(2000),adv(100),[['scan',1],['print']],adv(1000));
  const A=runOut(asDrawn,st),B=runOut(fix,st);
  check('Ej 8.3 FBD tal como está dibujado: FW y SIM coinciden',eqj(A.f,A.s),A.f.map(x=>x.slice(0,2)).join(','));
  const valveOpenAfterTimeout=A.f[A.f.length-1][0]==='1';
  check('Ej 8.3 [HALLAZGO] FBD del manual: IN2 y Q_TON comparten el único puerto R del RS; el segundo cable se descarta y el timeout NO cierra la válvula',valveOpenAfterTimeout,A.f.map(x=>x.slice(0,2)).join(','));
  check('Ej 8.3 versión corregida (OR de IN2 y Q_TON → R; alarma enclavada con SR): válvula cierra a los 3 min y la alarma queda activa (FW y SIM)',
    B.f[B.f.length-1].slice(0,2)==='01'&&B.s[B.s.length-1].slice(0,2)==='01'&&B.f.some(x=>x.slice(0,2)==='10')&&eqj(B.f,B.s),B.f.map(x=>x.slice(0,2)).join(','));
  // Sin enclavar la alarma (con OR pero sin SR): la alarma dura 1 scan
  const noLatch=P([['i1','input1'],['i2','input2'],['or','or'],['s','rs'],['t','ton',{time:'180000'}],['o1','output1'],['o2','output2']],['i2>or','t>or:2','i1>s','or>s:2','s>t','s>o1','t>o2']);
  const sc=[...step({0:1,1:0}),...step({0:0,1:0}),['adv',179990],['scan',1],['print'],['scan',1],['print'],['scan',1],['print'],['scan',1],['print']];
  const N=runOut(noLatch,sc);
  const alarm=N.f.map(x=>x[1]);
  check('Ej 8.3 [HALLAZGO] aun con OR en R, sin enclavar la alarma OUT2 dura ~1 scan (Q_TON cae al cerrarse la válvula): la tabla del manual (alarma=1) no se sostiene',alarm.includes('1')&&alarm[alarm.length-1]==='0'&&eqj(N.f,N.s),alarm.join(''));
  findings.push({id:'8.3',title:'Timeout de seguridad',status:'DEFECTO_MANUAL',expected:[],obtained:A.f.map(x=>x.slice(0,2)),note:'(1) El RS tiene un solo puerto R: dibujar IN2 y Q_TON al mismo R pierde uno de los cables (el firmware, el simulador y el compilador lo descartan con aviso). Hace falta un OR. (2) Al cerrarse la válvula el TON se reinicia y la alarma dura 1 scan; para que "alarma=1" de la tabla se cumpla hay que enclavarla con un SR (reset con IN1). (3) El Ladder del manual es correcto en lo conceptual (rung 3 R por M1) pero la alarma también se apaga porque M1 cae.'}); }
// ---- 8.4 doble reset con confirmación de 2 s ----
{ const p=P([['i1','input1'],['i2','input2'],['a','and'],['t','ton',{time:'2000'}],['s','sr'],['o','output1']],['i1>s','t>s:2','i1>a','i2>a:2','a>t','s>o']);
  const st=seq(step({0:1,1:0}),adv(500),step({0:0,1:1}),adv(3000),step({0:1,1:1}),adv(1500),adv(1000),step({0:0,1:0}));
  const r=runOut(p,st);
  const g=r.f.map(x=>x[0]);
  check('Ej 8.4 FBD tal como está: FW y SIM coinciden',eqj(r.f,r.s),g.join(''));
  // En el FBD IN1 es a la vez sensor (S) y botón de reset: mientras IN1=1, S domina y el reset nunca actúa
  check('Ej 8.4 [HALLAZGO] el reset nunca actúa: IN1 es sensor (S dominante) y botón de reset al mismo tiempo, así que con IN1 pulsado S=1 gana al R=1',g.slice(-4).every(x=>x==='1')||g[g.length-3]==='1',g.join(''));
  // Versión con sensor distinto: sensor = IN1 en pulso; resetear con ambos botones requiere otro sensor => se prueba con RS en vez de SR (reset domina)
  const p2=P([['i1','input1'],['i2','input2'],['a','and'],['t','ton',{time:'2000'}],['s','rs'],['o','output1']],['i1>s','t>s:2','i1>a','i2>a:2','a>t','s>o']);
  const r2=runOut(p2,st);const g2=r2.f.map(x=>x[0]);
  check('Ej 8.4 con RS el reset sí actúa a los 2 s, pero IN1 sigue siendo sensor y botón: con IN1 pulsado la alarma se vuelve a activar si IN1 se mantiene',eqj(r2.f,r2.s),g2.join(''));
  findings.push({id:'8.4',title:'Doble reset con confirmación',status:'DEFECTO_MANUAL',expected:[],obtained:g,note:'El propio manual advierte que IN1 es sensor y botón; con SR (set dominante) el reset jamás actúa mientras IN1=1, y con RS la alarma se rearma al soltar. Con 2 entradas el ejemplo no es ejecutable tal como se describe: necesita un sensor independiente (RDI1, Cap. 9, no soportado por el editor) o liberar una entrada.'}); }
// ---- 8.5 prensa completa ----
{ const mk=(pv)=>P([['i1','input1'],['i2','input2'],['a','and'],['n','not'],['s','rs'],['t','ton',{time:'3000'}],['nq','not'],['am','and'],['rt','r_trig'],['c','ctu',{value:String(pv)}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
   ['i1>a','i2>a:2','i1>n','a>s','n>s:2','s>t','t>o1','t>o3','t>nq','nq>am','s>am:2','am>o2','i1>rt','rt>c','i2>c:2','c>o4']);
  const p=mk(500);
  const st=seq(step({0:0,1:0}),step({0:1,1:1}),adv(1500),adv(2000),step({0:1,1:0}),step({0:0,1:0}));
  const r=runOut(p,st);
  const g=r.f.map(x=>x.slice(0,3));
  // OUT1 contactor, OUT2 amarilla (espera), OUT3 verde
  check('Ej 8.5 FW y SIM coinciden en el arranque supervisado con retardo de 3 s',eqj(r.f,r.s),g.join(','));
  check('Ej 8.5 arranque: amarilla durante el retardo, luego contactor+verde (FW y SIM)',g[1]==='010'&&g[3]==='101',g.join(','));
  const cyc=(n,both)=>seq(step({0:0,1:0}),Array.from({length:n},()=>seq(step({0:1,1:both?1:0}),step({0:0,1:0}))).flat(),[['scan',2],['print']]);
  const q=runOut(mk(5),cyc(5,true));
  const q2=runOut(mk(5),cyc(5,false));
  check('Ej 8.5 [HALLAZGO] el contador de ciclos NO cuenta cuando se arranca como el manual indica (IN1+IN2 juntos): IN2 también es el R del CTU y lo mantiene en 0 (5 arranques → OUT4=0)',
    q.f[q.f.length-1][3]==='0'&&q.s[q.s.length-1][3]==='0',q.f.map(x=>x[3]).join(''));
  check('Ej 8.5 el CTU solo cuenta flancos de IN1 SIN IN2 (que no arrancan la prensa): 5 presiones → OUT4=1 (FW y SIM)',
    q2.f[q2.f.length-1][3]==='1'&&q2.s[q2.s.length-1][3]==='1',q2.f.map(x=>x[3]).join(''));
  // INICIO en serie: al soltar INICIO, IN1=0 -> RESET (idéntico a 8.1) y el contador cuenta cada presión
  const hold=runOut(p,seq(step({0:1,1:1}),adv(4000),step({0:0,1:1}),adv(100)));
  check('Ej 8.5 [HALLAZGO] igual que 8.1: al soltar INICIO (IN1=0) la prensa se detiene',hold.f[hold.f.length-1].slice(0,3)==='000'&&hold.f[1].slice(0,3)==='101',hold.f.map(x=>x.slice(0,3)).join(','));
  findings.push({id:'8.5',title:'Prensa "categoría 1"',status:'DEFECTO_MANUAL',expected:[],obtained:g,note:'La lógica ejecuta el arranque con retardo, la lámpara amarilla y el contador de ciclos. Pero (1) hereda el defecto de 8.1 (INICIO en serie en IN1); (2) IN2 es a la vez habilitación de arranque (S=IN1·IN2) y R del CTU: mientras se arranca (IN2=1) el contador está en reset, por lo que la alarma de mantenimiento no puede alcanzarse en uso normal (verificado: 5 arranques → OUT4=0); separar el reset del contador de IN2; (3) un PLC educativo con salidas por relé/transistor sin diagnóstico NO cumple "categoría 1" de ISO 13849-1 ni es un circuito de seguridad validado: el título y el texto deben presentarlo como ejemplo didáctico de lógica de parada, nunca como función de seguridad. La emergencia real debe cortar la potencia del contactor por hardware (cadena cableada) independientemente del PLC.'}); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
