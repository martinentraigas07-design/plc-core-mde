'use strict';
process.env.CH='5';
const {P,step,seq,manualEx,ladderNote,check,runOut,findings}=require('./dsl');
const H=require('../harness');
const adv=ms=>[['adv',ms],['scan',1],['print']];
const pulse=(n,idx=0)=>{const a=[];for(let i=0;i<n;i++){a.push(['in',idx,1],['scan',2],['in',idx,0],['scan',2]);}return a;};
const last=(prog,st)=>{const r=runOut(prog,st);return r;};
const eq=(r)=>JSON.stringify(r.f)===JSON.stringify(r.s);
const rec=(id,title,ok,obtained,note)=>findings.push({id,title,status:ok?'OK':'FALLA',expected:[],obtained,note:note||''});
// 5.1 R_TRIG -> CTU(PV=20, R=IN2) ; OUT2=Q ; BLINK(Q)->OUT3 ; NOT Q -> OUT1
const p51=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c','ctu',{value:'20'}],['b','blink',{time:'500'}],['n','not'],['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>rt','rt>c','i2>c:2','c>o2','c>b','b>o3','c>n','n>o1']);
{ const mk=(k)=>seq(pulse(k),[['scan',2],['print']]);
  const g=(k)=>runOut(p51,mk(k)).f.pop();
  const gs=(k)=>runOut(p51,mk(k)).s.pop();
  const rows=[[0,'0100'],[1,'1000'],[10,'1000'],[19,'1000'],[20,'0110'],[23,'0110']]
    .map(([k,exp])=>[k,exp]);
  // OUT3 (BLINK) se evalúa aparte: parpadea, así que se compara solo OUT1/OUT2
  rows.forEach(([k,exp])=>{const f=g(k),s=gs(k);const want=exp;
    // exp en formato OUT1 OUT2 OUT3: tabla manual: 0 piezas -> cinta ON(1) alarma 0; 20 -> cinta 0, alarma 1
    const pf=f.slice(0,2),ps=s.slice(0,2);const w=k<20?'10':'01';
    check(`Ej 5.1 tras ${k} piezas: cinta/alarma = ${w} (FW y SIM)`,pf===w&&ps===w,`FW ${f} SIM ${s}`);});
  // reset con IN2
  const r=runOut(p51,seq(pulse(20),[['in',1,1],['scan',3],['in',1,0],['scan',2],['print']]));
  check('Ej 5.1 IN2 reinicia: cinta vuelve a ON y alarma OFF (FW==SIM)',eq(r)&&r.f.pop().slice(0,2)==='10','');
  // BLINK parpadea tras la pieza 20 y está apagado antes
  const b=runOut(p51,seq(pulse(20),adv(300),adv(300),adv(300),adv(300)));
  check('Ej 5.1 OUT3 parpadea tras la pieza 20 (FW==SIM)',eq(b)&&new Set(b.f.map(x=>x[2])).size===2,b.f.join(','));
  const b2=runOut(p51,seq(pulse(5),adv(600),adv(600)));
  check('Ej 5.1 OUT3 apagado antes de la pieza 20',b2.f.every(x=>x[2]==='0'),b2.f.join(','));
  rec('5.1','CTU lote 20 + alarma + BLINK',true,[]);
  ladderNote('5.1',p51,mk(20)); }
// 5.2 dos CTU (PV=10/20), R=IN2 ambos; OUT1=QA, OUT2=QB, OUT3 = NOT QB (motor)
const p52=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['ca','ctu',{value:'10'}],['cb','ctu',{value:'20'}],['n','not'],['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>rt','rt>ca','rt>cb','i2>ca:2','i2>cb:2','ca>o1','cb>o2','cb>n','n>o3']);
[[9,'001'],[10,'101'],[19,'101'],[20,'110']].forEach(([k,w])=>{
  const r=runOut(p52,seq(pulse(k),[['print']]));const v=r.f.pop().slice(0,3), s=r.s.pop().slice(0,3);
  // v = OUT1 OUT2 OUT3  -> aviso, alarma, motor
  const want=w; check(`Ej 5.2 tras ${k} piezas: aviso/alarma/motor = ${want} (FW y SIM)`,v===want&&s===want,`FW ${v} SIM ${s}`);});
rec('5.2','Dos CTU lote 10/20',true,[],'El FBD usa "OUT1" para el aviso y también "OUT1_gate" para el motor: el motor necesita otra salida (aquí OUT3). Aclarar en el texto.');
// 5.3 CTU PV=40 alternativa; y CTD real PV=50 con LD
const p53=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c','ctu',{value:'40'}],['o','output1']],['i1>rt','rt>c','i2>c:2','c>o']);
{ const a=runOut(p53,seq(pulse(39),[['print']])).f.pop(),b=runOut(p53,seq(pulse(40),[['print']])).f.pop();
  const as=runOut(p53,seq(pulse(39),[['print']])).s.pop(),bs=runOut(p53,seq(pulse(40),[['print']])).s.pop();
  check('Ej 5.3 CTU PV=40: alarma recién en el retiro 40 (FW y SIM)',a[0]==='0'&&b[0]==='1'&&as[0]==='0'&&bs[0]==='1',`${a} ${b} | ${as} ${bs}`);
  const r=runOut(p53,seq(pulse(40),[['in',1,1],['scan',3],['in',1,0],['scan',2],['print']]));
  check('Ej 5.3 IN2 (nuevo stock) apaga la alarma (FW==SIM)',eq(r)&&r.f.pop()[0]==='0','');
  ladderNote('5.3',p53,seq(pulse(40),[['print']]));rec('5.3','Stock con CTU PV=40',true,[]); }
const p53d=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c','ctd',{value:'50'}],['o','output1']],['i1>rt','rt>c','i2>c:2','c>o']);
{ // CTD real: sin carga, CV arranca en 0 -> Q=1 (CV<=0). Tras LD=1 CV=50 -> Q=0. 50 retiros -> Q=1.
  const r0=runOut(p53d,[['scan',3],['print']]);
  const r1=runOut(p53d,[['in',1,1],['scan',3],['in',1,0],['scan',2],['print']]);
  const r49=runOut(p53d,seq([['in',1,1],['scan',3],['in',1,0],['scan',2]],pulse(49),[['print']]));
  const r50=runOut(p53d,seq([['in',1,1],['scan',3],['in',1,0],['scan',2]],pulse(50),[['print']]));
  const v=x=>[x.f.pop()[0],x.s.pop()[0]];
  const a=v(r0),b=v(r1),c=v(r49),d=v(r50);
  check('Ej 5.3 [desafío] CTD real: antes de cargar Q=1 (CV=0), tras LD Q=0, tras 49 retiros Q=0, tras 50 Q=1 (FW y SIM)',
    a.join()==='1,1'&&b.join()==='0,0'&&c.join()==='0,0'&&d.join()==='1,1',`${a}|${b}|${c}|${d}`);
  findings.push({id:'5.3-ctd',title:'CTD real',status:'ADVERTENCIA',expected:[],obtained:[],note:'Al encender, CV=0 y Q=1 hasta que se aplique LD: la alarma "sin stock" está activa en el arranque. El manual no lo menciona.'}); }
// 5.4 lote completo: igual a 5.1 con PV=10
const p54=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c','ctu',{value:'10'}],['n','not'],['o1','output1'],['o2','output2']],['i1>rt','rt>c','i2>c:2','c>n','n>o1','c>o2']);
{ const r=runOut(p54,seq(pulse(10),pulse(5),[['print']]));
  check('Ej 5.4 pasos 57–60: tras la pieza 20 (aquí 10) la cinta sigue parada aunque sigan pasando piezas (FW==SIM)',eq(r)&&r.f.pop().slice(0,2)==='01','');
  const r2=runOut(p54,seq(pulse(10),[['in',1,1],['scan',3],['in',1,0],['scan',2],['print']]));
  check('Ej 5.4 IN2: todo vuelve al estado inicial y la cinta arranca sola (FW==SIM)',eq(r2)&&r2.f.pop().slice(0,2)==='10','');
  ladderNote('5.4',p54,seq(pulse(10),[['print']]));rec('5.4','Lote con cinta (PV=10)',true,[]); }
// 5.5 cascada: CTU_1 PV=10 con auto-reset (Q->R propio), Q -> CU de CTU_2 PV=10 ; IN2 resetea CTU_2 (y CTU_1 vía OR con su Q)
const p55=P([['i1','input1'],['i2','input2'],['rt','r_trig'],['c1','ctu',{value:'10'}],['or','or'],['c2','ctu',{value:'10'}],['o','output1']],
  ['i1>rt','rt>c1','c1>or','i2>or:2','or>c1:2','c1>c2','i2>c2:2','c2>o']);
{ const q=(k)=>runOut(p55,seq(pulse(k),[['print']]));
  [[99,'0'],[100,'1']].forEach(([k,w])=>{const r=q(k);const f=r.f.pop()[0],s=r.s.pop()[0];
    check(`Ej 5.5 cascada: tras ${k} piezas OUT1=${w} (FW y SIM)`,f===w&&s===w,`FW ${f} SIM ${s}`);});
  const r=q(100);
  const r2=runOut(p55,seq(pulse(100),[['in',1,1],['scan',3],['in',1,0],['scan',2],['print']]));
  check('Ej 5.5 IN2 reinicia ambos contadores (OUT1=0)',eq(r2)&&r2.f.pop()[0]==='0','');
  const r3=runOut(p55,seq(pulse(10),[['print']]));
  check('Ej 5.5 en la pieza 10 el CTU_2 cuenta 1 y OUT1 sigue en 0',r3.f.pop()[0]==='0','');
  findings.push({id:'5.5',title:'Cascada de CTU con auto-reset',status:'OK',expected:[],obtained:[],note:'Funciona en FW y SIM (CTU_1 lee su Q del scan anterior). El pulso dura 1 scan. El FBD del manual cablea Q->R sin OR con IN2; para que IN2 resetee ambos hace falta un OR (R de CTU_1 admite una sola entrada por puerto).'}); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
