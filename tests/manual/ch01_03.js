'use strict';
process.env.CH='1_3';
const {P,step,seq,manualEx,ladderNote,check,expectOut,runOut,findings}=require('./dsl');
const H=require('../harness');
const T=1,F=0;
// ===== Capítulo 1 =====
const direct=P([['i1','input1'],['o','output1']],['i1>o']);
const s11=seq(step({0:0}),step({0:1}),step({0:0}));
manualEx('1.1','Pulsador NA -> lámpara',direct,s11,['0000','1000','0000']);ladderNote('1.1',direct,s11);
manualEx('1.2','Interruptor de palanca',direct,seq(step({0:1}),step({0:1}),step({0:0})),['1000','1000','0000']);
manualEx('1.4','Sensor + relé',direct,s11,['0000','1000','0000']);
const and12=P([['i1','input1'],['i2','input2'],['a','and'],['o','output1']],['i1>a','i2>a:2','a>o']);
const s13=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:1,1:0}),step({0:0,1:0}));
manualEx('1.3','AND (verde NA + rojo NC)',and12,s13,['0000','1000','0000','0000']);ladderNote('1.3',and12,s13);
// 1.2 ejercicio: NOT entre IN1 y OUT1 = alarma de puerta abierta
const notp=P([['i1','input1'],['n','not'],['o','output1']],['i1>n','n>o']);
manualEx('1.2-ej','NOT: enciende con la puerta abierta',notp,seq(step({0:1}),step({0:0})),['0000','1000']);ladderNote('1.2-ej',notp,seq(step({0:1}),step({0:0})));
// ===== Capítulo 2 =====
// 2.1 Arranque/paro: pulsador de paro NC (IN2=1 en reposo)
const sr_drawn=P([['i1','input1'],['i2','input2'],['s','sr'],['o','output1']],['i1>s','i2>s:2','s>o']);
const sr_fixed=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['o','output1']],['i1>s','i2>n','n>s:2','s>o']);
const s21=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}),step({0:0,1:1}),
              step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}));   // último: cable de paro cortado => para
manualEx('2.1','Arranque/paro SR (paro NC)',sr_drawn,s21,['0000','1000','1000','0000','0000','1000','1000','0000'],sr_fixed,
  'El FBD dibuja IN2 (NC, vale 1 en reposo) directo a R: con R=1 en reposo el SR se resetea al soltar IN1. Falta un NOT entre IN2 y R.');
ladderNote('2.1',sr_fixed,s21);
{ // cable de paro cortado (IN2=0) y se pulsa ARRANQUE: el motor NO debe arrancar
  const st=seq(step({0:0,1:0}),step({0:1,1:0}),step({0:0,1:0}));
  const fx=runOut(sr_fixed,st), dr=runOut(P([['i1','input1'],['i2','input2'],['n','not'],['s','sr'],['o','output1']],['i1>s','i2>n','n>s:2','s>o']),st);
  check('Ej 2.1 corregido con RS(S=IN1,R=NOT IN2): con el cable de paro cortado NO arranca (FW y SIM)',fx.f.every(x=>x==='0000')&&fx.s.every(x=>x==='0000'),fx.f.join(','));
  check('Ej 2.1 [HALLAZGO] corregir solo con NOT pero dejando SR (S dominante): con el cable de paro cortado SÍ arranca',dr.f[1]==='1000'&&JSON.stringify(dr.f)===JSON.stringify(dr.s),dr.f.join(','));
  findings.push({id:'2.1-cable',title:'Cable de paro cortado',status:'ADVERTENCIA',expected:[],obtained:dr.f,note:'La corrección debe ser RS (reset dominante) con R=NOT(IN2), o SR con S=AND(IN1,IN2) como en el Ladder del manual. Un SR con solo el NOT permite arrancar con el cable de paro cortado.'}); }
// 2.2 Toggle con 7 nodos (R_TRIG, NOT, 2 AND, SR)
const tog=P([['i','input2'],['rt','r_trig'],['n','not'],['as','and'],['ar','and'],['s','sr'],['o','output1']],
  ['i>rt','rt>as','n>as:2','rt>ar','s>ar:2','s>n','as>s','ar>s:2','s>o']);
const s22=seq(step({1:0}),step({1:1}),step({1:0}),step({1:1}),step({1:0}),step({1:1}),step({1:0}));
manualEx('2.2','Toggle R_TRIG+SR (7 nodos)',tog,s22,['0000','1000','1000','0000','0000','1000','1000']);ladderNote('2.2',tog,s22);
// 2.3 Parada de emergencia NC: IN1 = cadena serie [EMERG NC]-[PARO NC]-[ARRANQUE NA]
const em_drawn=P([['i1','input1'],['i2','input2'],['s','sr'],['o','output1']],['i1>s','i2>s:2','s>o']);
const em_fixed=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['o','output1']],['i1>s','i2>n','n>s:2','s>o']);
// tabla del manual: normal(IN1=0) ->0 ; ARRANQUE (IN1=1) ->1 ; suelta ->1 ; EMERGENCIA => OUT1 forzado a 0
const s23=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}));
manualEx('2.3','Parada de emergencia NC',em_drawn,s23,['0000','1000','1000','0000'],em_fixed,
  'Mismo defecto de 2.1 (falta NOT en R). Además: si la emergencia solo está en la cadena de S, abrirla no detiene un motor ya en marcha; debe actuar sobre R.');
// 2.4 Enclavamiento de dos motores
// SR1: S=IN1, R=OR(IN2n,Q2) ; SR2: S=IN1 AND NOT Q1 ; R=Q1 OR IN2n   (IN2n = NOT IN2, paro NC)
const il=P([['i1','input1'],['i2','input2'],['pn','not'],['q1n','not'],['q2n','not'],
  ['a1','and'],['a2','and'],['r1','or'],['r2','or'],['m1','sr'],['m2','rs'],['o1','output1'],['o2','output2']],
  ['i2>pn','m2>q2n','m1>q1n','i1>a1','q2n>a1:2','a1>m1','pn>r1','m2>r1:2','r1>m1:2',
   'i1>a2','q1n>a2:2','a2>m2','pn>r2','m1>r2:2','r2>m2:2','m1>o1','m2>o2']);
const s24=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:0}),step({0:0,1:1}));
{ // 2.4: la tabla del manual solo exige exclusión mutua; quién gana con arranque simultáneo no está especificado.
  const r=runOut(il,s24);
  const never=l=>l.every(x=>!(x[0]==='1'&&x[1]==='1'));
  check('Ej 2.4 Interlock: nunca M1 y M2 a la vez (FW y SIM)',never(r.f)&&never(r.s)&&JSON.stringify(r.f)===JSON.stringify(r.s),r.f.join(',')+' | SIM '+r.s.join(','));
  const st=seq(step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}));
  const g=runOut(il,st);
  check('Ej 2.4 Interlock: con IN1 simultáneo gana un solo motor y se mantiene (FW==SIM)',JSON.stringify(g.f)===JSON.stringify(g.s)&&g.f[0]===g.f[1]&&g.f[2]==='0000',g.f.join(','));
  require('./dsl').findings.push({id:'2.4',title:'Interlock',status:'ADVERTENCIA',expected:['exclusión mutua'],obtained:g.f,note:'Con arranque simultáneo el ganador queda definido por el orden determinista (el motor cuya memoria es la de ID más bajo ve el estado previo del otro): aquí gana M2. El manual no lo especifica; no es un defecto, pero el ejemplo debería decir que el ganador es indistinto.'});
  ladderNote('2.4',il,s24);
}
// ===== Capítulo 3 =====
// 3.1 SR con indicación: OUT1=Q, OUT2=NOT Q. La tabla del manual usa IN2=1 en reposo (paro NC).
const sr31=P([['i1','input1'],['i2','input2'],['s','sr'],['n','not'],['o1','output1'],['o2','output2']],['i1>s','i2>s:2','s>o1','s>n','n>o2']);
const sr31f=P([['i1','input1'],['i2','input2'],['pn','not'],['s','rs'],['n','not'],['o1','output1'],['o2','output2']],['i1>s','i2>pn','pn>s:2','s>o1','s>n','n>o2']);
const s31=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}));
manualEx('3.1','SR con lámparas opuestas (tabla del manual, IN2 en reposo=1)',sr31,s31,['0100','1000','1000','0100'],sr31f,
  'La tabla de estados (reposo IN1=0,IN2=1; soltar IN1 mantiene) exige paro NC; el FBD dibujado conecta IN2 directo a R.');ladderNote('3.1',sr31f,s31);
// 3.2 RS: prioridad de reset. Tabla SR vs RS: (IN1=1,IN2=0 conflicto)... se usa R=IN2 como el diagrama (S=IN1,R=IN2)
const rs32=P([['i1','input1'],['i2','input2'],['s','rs'],['o','output1']],['i1>s','i2>s:2','s>o']);
const rs32n=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['o','output1']],['i1>s','i2>n','n>s:2','s>o']);
// tabla 3.2 (IN2 = habilitación/emergencia NC: 1=OK): reposo(0,1)->0 ; arranque normal(1,1)->1 ; paro normal(0,0)->0 ; conflicto(1,0)->RS 0
const s32=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:0}),step({0:1,1:0}));
manualEx('3.2','RS prioridad de reset (IN2 NC)',rs32,s32,['0000','1000','0000','0000'],rs32n,
  'Mismo defecto: el FBD conecta IN2 (NC) directo a R; el Ladder del mismo ejemplo usa [/ IN2] en el RESET.');
ladderNote('3.2',rs32n,s32);
// 3.3 Alarma con memoria, IN2 NA (reconocer)
const al33=P([['i1','input1'],['i2','input2'],['s','sr'],['o','output1']],['i1>s','i2>s:2','s>o']);
const s33=seq(step({0:0,1:0}),step({0:1,1:0}),step({0:1,1:0}),step({0:0,1:0}),step({0:0,1:1}),step({0:0,1:0}),step({0:1,1:0}),step({0:0,1:0}));
manualEx('3.3','Alarma con memoria',al33,s33,['0000','1000','1000','1000','0000','0000','1000','1000']);ladderNote('3.3',al33,s33);
// 3.3 variante BLINK 500 ms
const al33b=P([['i1','input1'],['i2','input2'],['s','sr'],['b','blink',{time:'500'}],['o','output1']],['i1>s','i2>s:2','s>b','b>o']);
{ const st=[['in',0,1],['scan',3],['in',0,0],['scan',1],['print'],['adv',600],['scan',1],['print'],['adv',600],['scan',1],['print'],['in',1,1],['scan',3],['print']];
  const r=require('./dsl').runOut(al33b,st);
  const ok=JSON.stringify(r.f)===JSON.stringify(r.s)&&r.f[0]!==r.f[1]&&r.f[3]==='0000';
  check('Ej 3.3-var BLINK 500 ms: parpadea mientras la alarma está activa y se apaga al reconocer (FW==SIM)',ok,r.f.join(',')+' | SIM '+r.s.join(',')); }
// 3.4 Dos lámparas alternadas con F_TRIG (toggle al SOLTAR). OUT1=Q, OUT2=NOT Q
const t34=P([['i','input1'],['ft','f_trig'],['n','not'],['as','and'],['ar','and'],['s','sr'],['nq','not'],['o1','output1'],['o2','output2']],
  ['i>ft','ft>as','n>as:2','ft>ar','s>ar:2','s>n','as>s','ar>s:2','s>o1','s>nq','nq>o2']);
const s34=seq(step({0:0}),step({0:1}),step({0:0}),step({0:1}),step({0:0}),step({0:1}),step({0:0}));
manualEx('3.4','Lámparas alternadas con F_TRIG',t34,s34,['0100','0100','1000','1000','0100','0100','1000']);ladderNote('3.4',t34,s34);
// 3.5 Enclavamiento con RS: cadena de seguridad IN1 (NC..NC + inicio NA), IN2 = supervisor (NA)
const sg35=P([['i1','input1'],['i2','input2'],['s','rs'],['o','output1']],['i1>s','i2>s:2','s>o']);
// Ladder: Rung1 SET si IN1 e IN2 ; Rung2 RESET si /IN1.  Equivalente FBD: S=AND(IN1,IN2), R=NOT IN1
const sg35c=P([['i1','input1'],['i2','input2'],['a','and'],['n','not'],['s','rs'],['o','output1']],['i1>a','i2>a:2','i1>n','a>s','n>s:2','s>o']);
const s35=seq(step({0:0,1:0}),step({0:1,1:1}),step({0:1,1:0}),step({0:0,1:0}),step({0:1,1:0}));
// esperado según el Ladder del ejemplo: arranque con (1,1)->1 ; (1,0) mantiene 1 ; cadena rota (0,x) -> 0 ; (1,0) sin supervisor no arranca
manualEx('3.5','Enclavamiento RS con cadena de seguridad',sg35,s35,['0000','1000','1000','0000','0000'],sg35c,
  'El FBD "simplificado" (S=IN1, R=IN2) no es el del Ladder (SET=IN1·IN2, RESET=/IN1): con IN2 NA como R, pulsar el supervisor resetea.');
ladderNote('3.5',sg35c,s35);
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
