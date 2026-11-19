'use strict';
process.env.CH='10';
const {P,step,seq,check,runOut,findings,ladderNote}=require('./dsl');
const H=require('../harness');
const adv=ms=>[['adv',ms],['scan',1],['print']];
const eqj=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pulse=(n,idx)=>{const a=[];for(let i=0;i<n;i++){a.push(['in',idx,1],['scan',2],['in',idx,0],['scan',2]);}return a;};
const T=c=>Math.round((c+0.5)*4095/50);
const ai=v=>[['ai',0,v],['scan',3],['print']];
// ---- 10.1 tanque ----
const p101=P([['i1','input1'],['i2','input2'],['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'50'}],
  ['n1','not'],['n2','not'],['m','rs'],['t','ton',{time:'600000'}],['hi','cmp',{op:'>',value:'40'}],['lo','cmp',{op:'<',value:'35'}],['f','sr'],
  ['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>n1','i2>n2','n1>m','n2>m:2','m>o1','m>t','t>o3','a>s','s>hi','s>lo','hi>f','lo>f:2','f>o2']);
{ const S=(l1,l2,t)=>[['in',0,l1],['in',1,l2],['ai',0,T(t)],['scan',3],['print']];
  const st=[S(1,1,30),S(0,1,30),S(0,1,42),S(1,1,42),S(1,0,42),S(1,1,30),S(0,1,30)].flat(1);
  const r=runOut(p101,st);
  const g=r.f.map(x=>x.slice(0,3));
  // OUT1 bomba, OUT2 ventilador, OUT3 alarma
  const want=['000','100','110','110','010','000','100'];
  // fila 4: nivel alto, T=42 -> bomba 0, ventilador según T (memoria: 1) ; fila 6: T baja a 30 (<35) y nivel medio -> ventilador 0
  check('Ej 10.1 tabla de estados (bomba por flotantes NC, ventilador con histéresis) en FW y SIM',eqj(g,want)&&eqj(r.s.map(x=>x.slice(0,3)),want),g.join(','));
  // fila "OK (medio) → bomba 0" solo vale en el arranque: tras llenar parcialmente, el nivel medio mantiene la bomba en 1
  check('Ej 10.1 [HALLAZGO] la fila "nivel medio (1,1) → bomba 0" solo es cierta si la bomba estaba parada: con la bomba en marcha el nivel medio la MANTIENE (memoria RS)',g[3][0]==='1',g.join(','));
  const to=runOut(p101,seq([['in',0,0],['in',1,1],['ai',0,T(30)],['scan',3],['print']],adv(300000),adv(299000),adv(2000)));
  check('Ej 10.1 timeout de 10 min con la bomba en marcha activa OUT3 (FW y SIM)',to.f[to.f.length-1][2]==='1'&&to.s[to.s.length-1][2]==='1'&&to.f[2][2]==='0',to.f.map(x=>x[2]).join(''));
  const ta=runOut(p101,[['in',0,1],['in',1,1],['ai',0,3276],['scan',3],['print'],['ai',0,3330],['scan',3],['print']]);
  check('Ej 10.1 [HALLAZGO] el manual dice "> 40 °C (> 3276 ADC)": con SCALE entero ADC 3276 se lee 39 °C y no activa el ventilador; se activa recién con ~3358 (41 °C)',ta.f[0][1]==='0'&&eqj(ta.f,ta.s),ta.f.map(x=>x[1]).join(''));
  findings.push({id:'10.1',title:'Tanque de agua',status:'ADVERTENCIA',expected:want,obtained:g,note:'La lógica de bomba, ventilador y timeout se cumple. Observaciones: la fila "nivel medio → bomba 0" solo aplica al arranque (RS retiene); el umbral "3276 ADC" del paso 75 no activa CMP>40 por el truncamiento de SCALE (hace falta ≈3358). El TON de 600 000 ms cuenta mientras la bomba está ON aunque el nivel suba; la alarma se apaga cuando la bomba para (no queda enclavada).'}); }
// ---- 10.2 línea de producción ----
const p102=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c','ctu',{value:'20'}],['n','not'],['b','blink',{time:'500'}],['rl','r_trig'],['cl','ctu',{value:'10'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['i1>rt','rt>c','i2>c:2','c>n','n>o1','c>o2','c>b','b>o3','c>rl','rl>cl','cl>o4']);
{ const lote=()=>seq(pulse(20,0),[['scan',2]],pulse(1,1),[['scan',2]]);
  const r1=runOut(p102,seq(pulse(19,0),[['scan',2],['print']]));
  const r2=runOut(p102,seq(pulse(20,0),[['scan',2],['print']]));
  check('Ej 10.2 pieza 19: cinta ON, sirena OFF; pieza 20: cinta OFF, sirena ON (FW y SIM)',r1.f[0].slice(0,2)==='10'&&r2.f[0].slice(0,2)==='01'&&r2.s[0].slice(0,2)==='01',r1.f[0]+' / '+r2.f[0]);
  const r3=runOut(p102,seq(Array.from({length:9},lote).flat(),[['scan',2],['print']]));
  const r4=runOut(p102,seq(Array.from({length:10},lote).flat(),pulse(20,0),[['scan',2],['print']]));
  check('Ej 10.2 con 9 lotes completos OUT4 sigue apagado (aún no es fin de turno)',r3.f[r3.f.length-1][3]==='0',r3.f[r3.f.length-1]);
  const r5=runOut(p102,seq(Array.from({length:10},()=>seq(pulse(20,0),[['scan',2],['print']],pulse(1,1),[['scan',2]])).flat(),pulse(20,0),[['scan',2],['print']]));
  // contar los lotes: 10 lotes completos (Q_lote sube 10 veces) deben activar OUT4 (fin de turno)
  const r6=runOut(p102,seq(Array.from({length:10},()=>seq(pulse(20,0),[['scan',2]],pulse(1,1),[['scan',2]])).flat(),[['scan',2],['print']]));
  const r7=runOut(p102,seq(Array.from({length:10},()=>seq(pulse(20,0),[['scan',2],['print']],pulse(1,1),[['scan',2]])).flat()));
  const okFin=r7.f.some(x=>x[3]==='1')&&eqj(r7.f,r7.s);
  check('Ej 10.2 fin de turno: tras 10 lotes completos OUT4 se activa (FW y SIM)',okFin,r7.f.map(x=>x[3]).join(''));
  check('Ej 10.2 [HALLAZGO] el contador de lotes nunca se reinicia: OUT4 queda en 1 por siempre; el manual no tiene reset de turno',r6.f[r6.f.length-1][3]==='1',r6.f[r6.f.length-1]);
  findings.push({id:'10.2',title:'Línea de producción',status:'ADVERTENCIA',expected:[],obtained:r7.f.map(x=>x[3]),note:'Funciona: 19→20 piezas, parada de cinta, sirena, parpadeo y fin de turno a los 10 lotes. No hay reset del contador de lotes (OUT4 queda enclavado hasta reiniciar el PLC). El ejemplo asigna IN2 a "reset lote"; el texto inicial (SR de arranque manual con IN1/IN2 largos) no se usa y debe quitarse. R_TRIG antes de CTU_LOTES es redundante (el CTU ya cuenta flancos).'}); }
// ---- 10.3 temperatura multinivel ----
const p103=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'100'}],['c25','cmp',{op:'>',value:'25'}],['c20','cmp',{op:'<',value:'20'}],['c35','cmp',{op:'>',value:'35'}],['c30','cmp',{op:'<',value:'30'}],['c45','cmp',{op:'>',value:'45'}],
  ['m1','sr'],['m2','sr'],['an','and'],['b','blink',{time:'500'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['a>s','s>c25','s>c20','s>c35','s>c30','s>c45','c25>m1','c20>m1:2','c35>m2','c30>m2:2','m2>an','m2>an:2','an>b','b>o3','m1>o1','m2>o2','c45>o4']);
{ const lv=t=>Math.round((t+0.5)*4095/100);
  const Ts=[15,26,36,46,40,31,29,22,19];
  const r=runOut(p103,Ts.flatMap(t=>[['ai',0,lv(t)],['scan',3],['print']]));
  const g=r.f.map(x=>x[0]+x[1]+x[3]);
  const want=['000','100','110','111','110','110','100','100','000'];
  check('Ej 10.3 baja/alta/falla con histéresis propia y alarma inmediata >45 (OUT1,OUT2,OUT4; FW y SIM)',eqj(g,want)&&eqj(r.s.map(x=>x[0]+x[1]+x[3]),want),g.join(','));
  findings.push({id:'10.3',title:'Alarma multinivel',status:'OK',expected:want,obtained:g,note:'OUT1 = "Vel. baja" en el FBD pero el ejercicio 3 habla de "zona Alta (OUT1)": inconsistencia de nombres. BLINK sobre AND(SR2,SR2) es redundante (basta SR2→BLINK).'}); }
// ---- 10.4 bomba con protecciones ----
{ const p=P([['i1','input1'],['i2','input2'],['n1','not'],['n2','not'],['m','rs'],['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'10'}],['lp','cmp',{op:'<',value:'1'}],['ad','and'],
    ['t','ton',{time:'300000'}],['st','sr'],['th','ton',{time:'3600000'}],['rt','r_trig'],['c','ctu',{value:'100'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
    ['i1>n1','i2>n2','n1>m','n2>m:2','m>o1','a>s','s>lp','lp>ad','m>ad:2','ad>o2','m>t','t>st','n2>st:2','st>o3','m>th','th>rt','rt>c','c>o4']);
  // El manual: CMP<0.5 bar con SCALE entero 0–10 bar: umbral 0.5 no es representable
  const bar=b=>Math.round(b/10*4095);
  const r=runOut(p,[[ 'in',0,0],['in',1,1],['ai',0,bar(5)],['scan',3],['print'],['ai',0,bar(0.2)],['scan',3],['print'],['ai',0,bar(0.7)],['scan',3],['print'],['ai',0,bar(1.5)],['scan',3],['print']]);
  const g=r.f.map(x=>x.slice(0,2));
  check('Ej 10.4 bomba ON (nivel bajo) con presión normal: OUT2 (seco) apagado (FW y SIM)',g[0]==='10'&&r.s[0].slice(0,2)==='10',g.join(','));
  check('Ej 10.4 [HALLAZGO] CMP<0,5 bar es inexpresable con SCALE entero (0–10 bar): 0,7 bar se lee 0 y dispara "marcha en seco"; el umbral efectivo usado aquí es <1 bar',g[1]==='11'&&g[2]==='11'&&g[3]==='10',g.join(','));
  const to=runOut(p,seq([['in',0,0],['in',1,1],['ai',0,bar(5)],['scan',3],['print']],adv(299000),adv(2000),[['in',1,0],['scan',3],['print']]));
  check('Ej 10.4 timeout 5 min con nivel alto sin llegar: OUT3 se enclava; al llegar a nivel alto (IN2=0) se resetea (FW y SIM)',to.f[to.f.length-2][2]==='1'&&to.f[to.f.length-1][2]==='0'&&eqj(to.f,to.s),to.f.map(x=>x[2]).join(''));
  findings.push({id:'10.4',title:'Bomba con protecciones',status:'DEFECTO_MANUAL',expected:[],obtained:g,note:'(1) CMP<0.5 bar no se puede expresar: CMP/SCALE trabajan con enteros; usar SCALE 0–100 (décimas de bar) y CMP<5. (2) "Presionar IN2 durante 3 s para resetear el contador de horas" (ejercicio) choca con IN2 = flotante de nivel alto. (3) El "contador de horas" (TON 3 600 000 ms → CTU PV=100) solo cuenta tramos de bomba ON ininterrumpidos de 1 hora: el TON se reinicia cada vez que la bomba para, así que ciclos más cortos no acumulan nada; además los contadores viven en RAM y se pierden al reiniciar (según el código; sin retención). No sirve como horómetro de servicio. Se verificó el TON de 5 min y el enclavamiento del SR_timeout; el TON de 1 h no se ejecutó completo.'}); }
// ---- 10.5 mezcla ----
const mk105=(fix)=>P([['i1','input1'],['i2','input2'],['ra','r_trig'],['rb','r_trig'],['ca','ctu',{value:'10'}],['cb','ctu',{value:'5'}],['ar','and'],['n','not'],['tp','tp',{time:'30000'}],['td','ton',{time:'30000'}],['tf','tof',{time:'5000'}],['rr','r_trig'],['ff','f_trig'],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['i1>ra','ra>ca','i2>rb','rb>cb','ca>ar','cb>ar:2','ar>n','n>o1','n>o2','ar>tp','tp>o3','ar>td','td>tf','tf>o4']
   .concat(fix?['tf>ff','ff>ca:2','ff>cb:2']:['tf>rr','rr>ca:2','rr>cb:2','i2>ca:2','i2>cb:2']));
{ const asDrawn=mk105(false);
  const st=seq(pulse(10,0),pulse(5,1),[['scan',2],['print']]);
  const r=runOut(asDrawn,st);
  check('Ej 10.5 [HALLAZGO] FBD tal como está (IN2 cuenta B y a la vez resetea ambos CTU): la receta nunca se completa (cintas siguen ON)',r.f[0].slice(0,2)==='11'&&eqj(r.f,r.s),r.f[0]);
  // Corrección: receta enclavada (RS), mezcla 30 s, descarga = TP 5 s tras la mezcla, reset al FINAL de la descarga (F_TRIG de la descarga)
  const f=P([['i1','input1'],['i2','input2'],['ra','r_trig'],['rb','r_trig'],['ca','ctu',{value:'10'}],['cb','ctu',{value:'5'}],['ar','and'],['L','rs'],['n','not'],['td','ton',{time:'30000'}],['tp5','tp',{time:'5000'}],['ff','f_trig'],['nm','not'],['am','and'],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
    ['i1>ra','ra>ca','i2>rb','rb>cb','ca>ar','cb>ar:2','ar>L','ff>L:2','L>n','n>o1','n>o2','L>td','td>tp5','tp5>o4','tp5>ff','ff>ca:2','ff>cb:2','td>nm','nm>am','L>am:2','am>o3']);
  const run=seq(pulse(10,0),pulse(5,1),[['scan',2],['print']],adv(1000),adv(28000),adv(2000),adv(4500),adv(500));
  const q=runOut(f,run);
  const gg=q.f;
  check('Ej 10.5 corregido: receta completa → cintas OFF y mezcladora ON (FW y SIM)',gg[0]==='0010'&&q.s[0]==='0010'&&gg[1]==='0010',gg.join(','));
  check('Ej 10.5 corregido: a los 30 s mezcladora OFF y descarga ON 5 s; a los 35 s descarga OFF y cintas ON (ciclo automático, FW y SIM)',
    gg[3]==='0001'&&gg[gg.length-1]==='1100'&&eqj(gg,q.s),gg.join(','));
  // segundo ciclo: tras el reset los contadores vuelven a cero y se puede repetir la receta
  const q2=runOut(f,seq(run,pulse(10,0),pulse(5,1),[['scan',2],['print']]));
  check('Ej 10.5 corregido: el ciclo se repite (segunda receta completa vuelve a parar las cintas)',q2.f[q2.f.length-1]==='0010'&&eqj(q2.f,q2.s),q2.f[q2.f.length-1]);
  findings.push({id:'10.5',title:'Mezcla automatizada',status:'DEFECTO_MANUAL',expected:[],obtained:r.f,note:'(1) IN2 cuenta unidades de B y también va al R de ambos CTU: cada pulso de B resetea los contadores y la receta no se completa. Con 2 entradas no hay forma de separar "contar B" de "resetear": el ejemplo necesita RDI (Cap. 9, no ejecutable) o reducirse a un solo ingrediente. (2) El texto usa un R_TRIG de Q_TOF y lo describe como flanco descendente: R_TRIG detecta el ascendente, por lo que el reset ocurre al ABRIR la descarga (las cintas arrancan mientras se descarga). Un F_TRIG sobre ese TOF no sirve (el TOF no cae mientras la receta siga completa: queda trabado). Corrección ejecutada: receta enclavada con RS, descarga con TP de 5 s tras la mezcla y reset de los CTU con F_TRIG de la descarga. (3) La alarma >70 °C no está cableada (solo descripta). (4) Ladder: nivel 3 por R_TRIG/F_TRIG y TOF encadenado.'}); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
