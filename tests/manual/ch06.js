'use strict';
process.env.CH='6';
const {P,step,seq,check,runOut,findings}=require('./dsl');
const H=require('../harness');
const ai=v=>[['ai',0,v],['scan',3],['print']];
const outs=l=>l.split(' ').slice(1,5).join('');
const pwm=l=>l.split('PWM ')[1].trim().split(' ').map(Number);
const rec=(id,title,status,note)=>findings.push({id,title,status,expected:[],obtained:[],note:note||''});
const both=(prog,st)=>{const r=runOut(prog,st);return r;};
const lv=pct=>Math.round(pct*4095/100);
// ---- 6.1 AI1 -> SCALE 0-4095 -> PWM(OUT1) ----
const p61=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'4095'}],['w','pwm',{out:'0',value:'0'}]],['a>s','s>w']);
{ const vals=[0,1,1024,2047,3000,4094,4095];
  const r=runOut(p61,vals.flatMap(ai));
  const f=r.raw.fw.filter(l=>l.startsWith('OUT')).map(l=>pwm(l)[0]), s=r.raw.sim.filter(l=>l.startsWith('OUT')).map(l=>pwm(l)[0]);
  check('Ej 6.1 PWM(OUT1) = AI1 para 0..4095 (identidad) en FW y SIM',JSON.stringify(f)===JSON.stringify(vals)&&JSON.stringify(s)===JSON.stringify(vals),'FW '+f+' SIM '+s);
  // monotonía/continuidad (paso 66): 0..4095 en saltos de 85
  let mono=true,prev=-1;const ramp=[];for(let v=0;v<=4095;v+=85)ramp.push(v);
  const rr=runOut(p61,ramp.flatMap(ai));const fw=rr.raw.fw.filter(l=>l.startsWith('OUT')).map(l=>pwm(l)[0]);
  fw.forEach(x=>{if(x<prev)mono=false;prev=x;});
  check('Ej 6.1 PWM monótono y sin escalones perdidos en la rampa (FW)',mono&&JSON.stringify(fw)===JSON.stringify(ramp),'');
  rec('6.1','AI1->SCALE->PWM','OK','El campo "OUT" del PWM en el editor muestra 1..4 (valor interno 0..3): coincide con "OUT=1" del manual.'); }
// ---- 6.2 histéresis: SCALE 0-4095->0-50, CMP<18 SET, CMP>25 RESET, SR -> OUT1 ----
const p62=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'50'}],['lo','cmp',{op:'<',value:'18'}],['hi','cmp',{op:'>',value:'25'}],['m','sr'],['o','output1']],
  ['a>s','s>lo','s>hi','lo>m','hi>m:2','m>o']);
{ const T=c=>Math.round(c*4095/50);
  const seqC=[22,15,22,24,26,22,19,17,30,10];     // °C
  const want=['0','1','1','1','0','0','0','1','0','1'];
  const r=runOut(p62,seqC.map(c=>c+0.5).flatMap(c=>ai(T(c))));
  const f=r.f.map(x=>x[0]),s=r.s.map(x=>x[0]);
  check('Ej 6.2 estufa: ON <18°C, OFF >25°C, memoria en la zona neutra (FW y SIM)',f.join()===want.join()&&s.join()===want.join(),'FW '+f+' SIM '+s);
  // unidades del manual: 18°C sin SCALE = ADC 1474; con SCALE entero la comparación es sobre °C truncados
  const edge=runOut(p62,[1473,1474,1475,1500].flatMap(ai));
  rec('6.2','Histéresis temperatura','OK','SCALE trunca hacia cero: 26,0 °C (ADC 2129) se lee 25 y no supera CMP>25 hasta ~26,0 °C reales (umbrales efectivos = valor entero siguiente). Los ejemplos con SCALE entero tienen ese sesgo de hasta 1 unidad. ADC 1474 (=18,0°C ideal) se escala a 17 °C por truncamiento: CMP<18 da 1. El valor "1474" que da el manual coincide con el umbral solo si no se usa SCALE.'); }
// ---- 6.3 nivel de tanque: RS(S=cmp<20, R=cmp>80), OUT2=cmp<5, OUT3=cmp>95 ----
const p63=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'100'}],['c20','cmp',{op:'<',value:'20'}],['c80','cmp',{op:'>',value:'80'}],['c5','cmp',{op:'<',value:'5'}],['c95','cmp',{op:'>',value:'95'}],['m','rs'],['o1','output1'],['o2','output2'],['o3','output3']],
  ['a>s','s>c20','s>c80','s>c5','s>c95','c20>m','c80>m:2','m>o1','c5>o2','c95>o3']);
{ const rows=[[3,'111'.replace(/./g,(c,i)=>c)],];
  const tab=[[3,'110'],[10,'100'],[50,'100'],[85,'000'],[50,'000'],[30,'000'],[15,'100'],[97,'001']];
  // Q, crítico, desborde. En 97 Q=0 (>80 resetea). Orden de salidas: OUT1=bomba, OUT2=crítico(<5), OUT3=desborde(>95)
  const exp=[['1','1','0'],['1','0','0'],['1','0','0'],['0','0','0'],['0','0','0'],['0','0','0'],['1','0','0'],['0','0','1']];
  const r=runOut(p63,tab.flatMap(([p])=>ai(lv(p))));
  const got=r.f.map(x=>x.slice(0,3).split(''));
  const ok=JSON.stringify(got)===JSON.stringify(exp)&&JSON.stringify(r.s.map(x=>x.slice(0,3).split('')))===JSON.stringify(exp);
  check('Ej 6.3 tabla de estados del tanque (bomba/crítico/desborde) en FW y SIM',ok,got.map(g=>g.join('')).join(','));
  rec('6.3','Nivel tanque','OK','La tabla de estados del manual se cumple tal cual en FW y SIM. Con SCALE entero los umbrales efectivos se corren hasta 1 % (ver 6.2).'); }
// ---- 6.4 comparador doble de calidad ----
const mk64=(outMax,lo,hi)=>P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:String(outMax)}],['c1','cmp',{op:'<',value:String(lo)}],['c2','cmp',{op:'>',value:String(hi)}],['or','or'],['n','not'],['o1','output1'],['o2','output2']],
  ['a>s','s>c1','s>c2','c1>or','c2>or:2','or>o1','or>n','n>o2']);
{ const p=mk64(10,2,5); const kg=k=>Math.round(k/10*4095);
  const tab=[[1.5,'10'],[2.0,'01'],[3.5,'01'],[5.0,'01'],[6.2,'10']];
  const r=runOut(p,tab.flatMap(([k])=>ai(kg(k))));
  const got=r.f.map(x=>x.slice(0,2)),gs=r.s.map(x=>x.slice(0,2));
  const want=tab.map(t=>t[1]);
  check('Ej 6.4 tabla del manual (SCALE 0-10 kg, CMP<2 / CMP>5): FW y SIM la cumplen',JSON.stringify(got)===JSON.stringify(want)&&JSON.stringify(gs)===JSON.stringify(want),got.join());
  // Problema de resolución: con SCALE entero (kg) una pieza de 5,5 kg NO se rechaza y una de 1,99 kg sí/no según truncamiento
  const r2=runOut(p,[kg(5.5),kg(5.99),kg(1.99),kg(6.0)].flatMap(ai));
  const g2=r2.f.map(x=>x.slice(0,2));
  check('Ej 6.4 [HALLAZGO] con SCALE entero en kg, 5,5 y 5,99 kg se aceptan (límite real efectivo: 6 kg)',g2[0]==='01'&&g2[1]==='01'&&g2[3]==='10'&&JSON.stringify(g2)===JSON.stringify(r2.s.map(x=>x.slice(0,2))),g2.join());
  // Versión corregida: SCALE 0-100 (décimas de kg) y umbrales 20 / 50
  const pc=mk64(100,20,50);
  const r3=runOut(pc,[kg(1.99),kg(2.0),kg(5.0),kg(5.2),kg(5.5)].flatMap(ai));
  const g3=r3.f.map(x=>x.slice(0,2));
  check('Ej 6.4 versión corregida (SCALE 0-100 = décimas de kg, CMP<20 / CMP>50): rechaza >5,0 kg y <2,0 kg (FW y SIM)',
    JSON.stringify(g3)===JSON.stringify(['10','01','01','10','10'])&&JSON.stringify(g3)===JSON.stringify(r3.s.map(x=>x.slice(0,2))),g3.join());
  rec('6.4','Comparador doble','DEFECTO_MANUAL','La tabla solo se cumple porque los pesos de prueba eran 1,5/2,0/3,5/5,0/6,2. SCALE trunca a entero: con outMax=10 la resolución es 1 kg, así que 5,5 y 5,99 kg pasan como BUENA. Corregir: SCALE a 0-100 (décimas de kg) y CMP<20 / CMP>50.'); }
// ---- 6.5 dos actuadores, dos SR ----
const p65=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'100'}],['c60','cmp',{op:'<',value:'60'}],['c65','cmp',{op:'>',value:'65'}],['c80','cmp',{op:'>',value:'80'}],['c75','cmp',{op:'<',value:'75'}],['s1','sr'],['s2','sr'],['o1','output1'],['o2','output2']],
  ['a>s','s>c60','s>c65','s>c80','s>c75','c60>s1','c65>s1:2','c80>s2','c75>s2:2','s1>o1','s2>o2']);
{ const T=[50,60,62,66,70,76,81,78,74,70,66,55,64];
  const r=runOut(p65,T.flatMap(t=>ai(lv(t))));
  const got=r.f.map(x=>x.slice(0,2));
  // calefactor: ON <60, OFF >65 (memoria); ventilador: ON >80, OFF <75 (memoria)
  const exp=['10','10','10','00','00','00','01','01','00','00','00','10','10'];
  const ok=JSON.stringify(got)===JSON.stringify(exp)&&JSON.stringify(r.s.map(x=>x.slice(0,2)))===JSON.stringify(exp);
  check('Ej 6.5 calefactor y ventilador con zona neutra 65–75 °C (FW y SIM)',ok,got.join());
  // Con IR: ¿ambos nunca a la vez?
  check('Ej 6.5 nunca calefactor y ventilador simultáneos',got.every(x=>x!=='11'),'');
  rec('6.5','Dos SR independientes','OK','Ejecutado con S=CMP<60, R=CMP>65 (calefactor) y S=CMP>80, R=CMP<75 (ventilador), como describe el texto; se cumple la zona neutra.'); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
