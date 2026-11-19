'use strict';
process.env.CH='7';
const {P,step,seq,check,runOut,findings,ladderNote}=require('./dsl');
const H=require('../harness');
const adv=ms=>[['adv',ms],['scan',1],['print']];
const ai=v=>[['ai',0,v],['scan',3],['print']];
const lv=pct=>Math.round((pct+0.5)*4095/100);
const rec=(id,title,status,note)=>findings.push({id,title,status,expected:[],obtained:[],note:note||''});
const eqj=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// ---- 7.1 motor con contactor: IN2 NC. FBD dibujado (SR con IN2 directo a R) y corregido (RS con NOT) ----
const mk71=(fixed)=>fixed
 ?P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','ton',{time:'3000'}],['nq','not'],['o1','output1'],['o2','output2'],['o3','output3']],['i1>s','i2>n','n>s:2','s>t','t>o1','t>o2','t>nq','nq>o3'])
 :P([['i1','input1'],['i2','input2'],['s','sr'],['t','ton',{time:'3000'}],['nq','not'],['o1','output1'],['o2','output2'],['o3','output3']],['i1>s','i2>s:2','s>t','t>o1','t>o2','t>nq','nq>o3']);
const s71=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(2000),adv(1200),step({0:0,1:0}),step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(3500),step({0:0,1:0}),step({0:1,1:0}));
const exp71=['0001','0001','0001','0001','1101','0001','0001','0001','0001','1101','0001','0001'].map(x=>x);
// OUT1..3 = K1, verde, roja  (OUT4 libre) -> "1100"+... se compara con 3 dígitos
const t3=l=>l.map(x=>x.slice(0,3));
const e3=['001','001','001','001','110','001','001','001','001','110','001','001'];
{ const a=runOut(mk71(false),s71),c=runOut(mk71(true),s71);
  check('Ej 7.1 FBD del manual: FW y SIM coinciden',eqj(a.f,a.s),'');
  check('Ej 7.1 [HALLAZGO] el FBD tal como está dibujado NO cumple la tabla (paro NC sin NOT)',!eqj(t3(a.f),e3),t3(a.f).join(','));
  check('Ej 7.1 versión corregida (RS + NOT en IN2) cumple la tabla (FW y SIM)',eqj(t3(c.f),e3)&&eqj(t3(c.s),e3),t3(c.f).join(','));
  // fila "Cable IN2 cortado": el motor en marcha debe parar
  const cut=runOut(mk71(true),seq(step({0:1,1:1}),step({0:0,1:1}),adv(3500),step({0:0,1:0})));
  check('Ej 7.1 cable de IN2 cortado con motor en marcha: K1 y verde caen, roja enciende',t3(cut.f).pop()==='001'&&t3(cut.s).pop()==='001','');
  findings.push({id:'7.1',title:'Motor con contactor',status:'DEFECTO_MANUAL',expected:e3,obtained:t3(a.f),note:'Mismo defecto de 2.1: IN2 (paro NC) conectado directo a R. Corregir con RS (R=NOT IN2). El Ladder del ejemplo sí es correcto (IN2 en serie con SET y [/IN2] en RESET).'});
  ladderNote('7.1',mk71(true),s71); }
// ---- 7.2 estrella-triángulo ----
// FBD tal como está dibujado: K1=SR.Q ; TON(8 s) ; K3=Q_TON ; K2=NOT(Q_TON)  (IN2 NC -> NOT/RS como en 2.1)
const mk72=(fix,dead)=>P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','ton',{time:'8000'}],['nq','not'],['a','and'],['d','ton',{time:'100'}],['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>s','i2>n','n>s:2','s>o1','s>t','t>nq'].concat(fix?['nq>a','s>a:2','a>o2']:['nq>o2']).concat(dead?['t>d','d>o3']:['t>o3']));
{ const st=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(7000),adv(1500),step({0:0,1:0}));
  const want=['000','110','110','110','101','000'];
  const a=runOut(mk72(false,false),st);
  check('Ej 7.2 FBD del manual: FW y SIM coinciden',eqj(a.f,a.s),'');
  check('Ej 7.2 [HALLAZGO] FBD del manual: con el motor PARADO la bobina K2 (estrella) queda ENERGIZADA (OUT2=NOT Q_TON=1)',a.f[0].slice(0,3)==='010'&&a.f[5].slice(0,3)==='010',a.f.map(x=>x.slice(0,3)).join(','));
  const c=runOut(mk72(true,false),st);
  check('Ej 7.2 corregido (K2 = NOT(Q_TON) AND SR.Q): cumple la tabla (FW y SIM)',eqj(c.f.map(x=>x.slice(0,3)),want)&&eqj(c.s.map(x=>x.slice(0,3)),want),c.f.map(x=>x.slice(0,3)).join(','));
  check('Ej 7.2 K2 y K3 nunca energizados a la vez',c.f.every(x=>!(x[1]==='1'&&x[2]==='1')),'');
  const fine=runOut(mk72(true,false),seq(step({0:1,1:1}),step({0:0,1:1}),adv(7990),[['scan',1],['print']],[['scan',1],['print']]));
  const sameScan=fine.f.some((x,i)=>i&&fine.f[i-1].slice(1,3)==='10'&&x.slice(1,3)==='01');
  check('Ej 7.2 [HALLAZGO] K2 pasa a OFF y K3 a ON en el MISMO scan (sin tiempo muerto estrella→triángulo)',sameScan,fine.f.map(x=>x.slice(1,3)).join(','));
  const fb=runOut(mk72(true,true),seq(step({0:1,1:1}),step({0:0,1:1}),adv(7990),[['scan',1],['print']],adv(50),adv(80)));
  const f2=fb.f.map(x=>x.slice(1,3));
  check('Ej 7.2 versión con tiempo muerto: pausa de ~100 ms con K2=K3=OFF antes del triángulo (FW==SIM)',fb.f.every(x=>!(x[1]==='1'&&x[2]==='1'))&&f2.includes('00')&&f2[f2.length-1]==='01'&&eqj(fb.f,fb.s),f2.join(','));
  findings.push({id:'7.2',title:'Estrella-triángulo',status:'DEFECTO_MANUAL',expected:want,obtained:a.f.map(x=>x.slice(0,3)),note:'(1) OUT2=NOT(Q_TON) deja K2 energizado con el motor parado (la tabla dice 0); falta AND con Q del SR. El Ladder rung 6 [/M2] tiene el mismo defecto. (2) K2 cae y K3 sube en el mismo scan: añadir ≈100 ms de tiempo muerto (TON sobre Q_TON) y aclarar que solo el enclavamiento cableado garantiza la exclusión. (3) IN2 NC: mismo NOT/RS de 2.1.'}); }
// ---- 7.3 semáforo ----
const p73=P([['i1','input1'],['p','tp',{time:'20000'}],['n','not'],['t','ton',{time:'3000'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],['i1>p','p>o1','p>n','n>o2','i1>t','t>o3','t>o4']);
{ const st=seq(step({0:0}),step({0:1}),adv(1000),adv(2500),adv(1000),step({0:0}),adv(14000),adv(2000),step({0:0}));
  const r=runOut(p73,st);
  const g=r.f;
  // normal | t=0 (IN1) | 1 s | 3,5 s | 4,5 s (IN1 sigue 1) | suelta IN1 | ~ 18 s | ~ 20+ s
  check('Ej 7.3 estado normal: verde vehicular ON, resto OFF (FW y SIM)',g[0]==='0100'&&r.s[0]==='0100',g[0]);
  check('Ej 7.3 t=0: rojo ON verde veh OFF, peatón aún OFF (FW y SIM)',g[1]==='1000'&&r.s[1]==='1000',g[1]);
  check('Ej 7.3 t≥3 s: peatón verde y acústica ON (FW y SIM)',g[3]==='1011'&&r.s[3]==='1011',g[3]);
  check('Ej 7.3 el TON de peatón depende de que IN1 SIGA presionado',g[5]==='1000'||g[5]==='1000',g.join(','));
  // Si el peatón suelta IN1 antes de 3 s, no hay verde peatonal pero sí rojo 20 s
  const sh=runOut(p73,seq(step({0:1}),adv(500),step({0:0}),adv(5000)));
  check('Ej 7.3 [HALLAZGO] si el peatón suelta IN1 antes de 3 s: rojo 20 s pero el verde peatonal NUNCA enciende',sh.f.every(x=>x[2]==='0')&&sh.f.some(x=>x[0]==='1')&&eqj(sh.f,sh.s),sh.f.join(','));
  findings.push({id:'7.3',title:'Semáforo peatonal',status:'DEFECTO_MANUAL',expected:[],obtained:sh.f,note:'El TON de 3 s se alimenta directo de IN1: el verde peatonal solo sale si el pulsador se mantiene 3 s. Un pulsador momentáneo (lo normal) deja a los autos en rojo 20 s sin verde para el peatón. Corregir: TON(3000) alimentado por Q del TP (retardo desde que empieza el rojo) y OUT3 = TON AND Q_TP para cortar al finalizar los 20 s. Con la versión del manual el verde peatonal se apaga al soltar IN1, no a los 20 s de la tabla.'});
  // versión corregida
  const p73b=P([['i1','input1'],['p','tp',{time:'20000'}],['n','not'],['t','ton',{time:'3000'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],['i1>p','p>o1','p>n','n>o2','p>t','t>o3','t>o4']);
  const c=runOut(p73b,seq(step({0:1}),adv(500),step({0:0}),adv(3000),adv(10000),adv(8000),adv(2000)));
  const want=['1000','1000','1011','1011','0100','0100'];
  check('Ej 7.3 versión corregida (TON habilitado por Q_TP) con pulsador momentáneo: rojo 20 s, peatón 3–20 s, luego normal (FW y SIM)',
    eqj(c.f.slice(0,3),['1000','1000','1000'])&&c.f[3]==='1011'&&c.f[c.f.length-1]==='0100'&&eqj(c.f,c.s),c.f.join(',')); }
// ---- 7.4 alarma multizona ----
const mk74=(mem)=>P([['i1','input1'],['i2','input2'],['rst','and'],['m1',mem],['m2',mem],['or','or'],['b','blink',{time:'500'}],['o','output1']],['i1>rst','i2>rst:2','i1>m1','rst>m1:2','i2>m2','rst>m2:2','m1>or','m2>or:2','or>b','b>o']);
{ const one=[['in',0,1],['scan',3],['in',0,0],['scan',2],['print'],['adv',600],['scan',1],['print'],['adv',600],['scan',1],['print']];
  const r=runOut(mk74('sr'),one);
  check('Ej 7.4 una zona activa: la sirena parpadea y queda enclavada (FW==SIM)',eqj(r.f,r.s)&&new Set(r.f.map(x=>x[0])).size===2,r.f.join(','));
  // RESET = AND(IN1,IN2): con SR (S dominante) NUNCA resetea
  const both=[['in',0,1],['in',1,1],['scan',3],['in',0,0],['in',1,0],['scan',2],['print'],['adv',600],['scan',1],['print'],['adv',600],['scan',1],['print']];
  const sr=runOut(mk74('sr'),both),rs=runOut(mk74('rs'),both);
  check('Ej 7.4 [HALLAZGO] con SR (como dibuja el manual) activar IN1 e IN2 a la vez NO resetea: las alarmas quedan enclavadas',new Set(sr.f.map(x=>x[0])).size===2&&eqj(sr.f,sr.s),sr.f.join(','));
  check('Ej 7.4 con RS la combinación IN1+IN2 resetea, pero entonces dos zonas disparadas a la vez no alarman (FW==SIM)',rs.f.every(x=>x[0]==='0')&&eqj(rs.f,rs.s),rs.f.join(','));
  findings.push({id:'7.4',title:'Alarma multizona',status:'DEFECTO_MANUAL',expected:[],obtained:sr.f,note:'El reset AND(IN1,IN2) usa las mismas entradas que los sensores: con SR (set dominante, como el FBD) el reset nunca actúa; con RS el reset aparece cuando ambas zonas disparan a la vez (se pierde la alarma). El Ladder del manual (SET y RESET sobre la misma bobina) se compila en este proyecto como latch con SET dominante, igual que el SR del FBD. Recomendación: no resolverlo con 2 entradas; usar RDI/IN2 dedicado de reset (ver Cap. 9) o mostrar explícitamente la limitación.'}); }
// ---- 7.5 ventilación 3 velocidades ----
const hy=(n,on,off)=>[[`c${n}h`,'cmp',{op:'>',value:String(on)}],[`c${n}l`,'cmp',{op:'<',value:String(off)}],[`m${n}`,'sr']];
const p75=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'100'}],...hy(1,35,30),...hy(2,45,40),...hy(3,55,50),['o1','output1'],['o2','output2'],['o3','output3']],
  ['a>s','s>c1h','s>c1l','s>c2h','s>c2l','s>c3h','s>c3l','c1h>m1','c1l>m1:2','c2h>m2','c2l>m2:2','c3h>m3','c3l>m3:2','m1>o1','m2>o2','m3>o3']);
{ const T=[25,32,36,46,56,52,48,42,38,32,28];
  const exp=['000','000','100','110','111','111','110','110','100','100','000'];
  const r=runOut(p75,T.flatMap(t=>ai(lv(t))));
  const g=r.f.map(x=>x.slice(0,3));
  check('Ej 7.5 tabla: baja >35, media >45, alta >55 con histéresis de 5 °C (FW y SIM)',eqj(g,exp)&&eqj(r.s.map(x=>x.slice(0,3)),exp),g.join(','));
  findings.push({id:'7.5',title:'Ventilación 3 velocidades',status:'ADVERTENCIA',expected:exp,obtained:g,note:'La tabla del manual dice "55–50 °C (bajando): 1 1 0", pero la histéresis apaga la alta recién por debajo de 50 °C; entre 55 y 50 la alta sigue ON (1 1 1). Ejecutado: 52 °C → 111, 48 °C → 110. Corregir la fila de la tabla.'}); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
