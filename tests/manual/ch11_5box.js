'use strict';
process.env.CH='11';
const {P,step,seq,check,runOut,findings}=require('./dsl');
const H=require('../harness');
const eqj=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Cap. 5 "Regla fundamental" y Cap. 11.4: "CTU sin R_TRIG cuenta varias veces por pulso"
const direct=P([['i','input1'],['c','ctu',{value:'3'}],['o','output1']],['i>c','c>o']);
{ const r=runOut(direct,[['in',0,1],['scan',50],['print'],['in',0,0],['scan',3],['in',0,1],['scan',50],['print'],['in',0,0],['scan',3],['in',0,1],['scan',50],['print']]);
  // 3 pulsos largos (50 scans = 500 ms) con PV=3: si contara por scan llegaría a 3 en el primer pulso
  check('Cap.5/11.4 [HALLAZGO] CTU SIN R_TRIG ya cuenta una sola vez por pulso (aunque dure 50 scans): Q=0 tras 1 y 2 pulsos, Q=1 al 3.º (FW y SIM)',
    r.f[0][0]==='0'&&r.f[1][0]==='0'&&r.f[2][0]==='1'&&eqj(r.f,r.s),r.f.join(','));
  findings.push({id:'5-regla',title:'Regla "siempre R_TRIG antes del CTU"',status:'DEFECTO_MANUAL',expected:[],obtained:r.f,note:'El recuadro del Cap. 5 ("CTU cuenta 5, incorrecto") y la fila de 11.4 ("Contador cuenta varias veces por cada pulso → falta R_TRIG") son falsos para este firmware y simulador: CTU/CTD cuentan solo en flanco ascendente de CU/CD. El R_TRIG es inofensivo pero redundante. Corregir el texto. (Ver nota equivalente ya corregida en firmware/MANUAL_PROGRAMACION.md.)'}); }
// 11.4: toggle sin flanco oscila
{ const tog=P([['i','input1'],['n','not'],['as','and'],['ar','and'],['s','sr'],['o','output1']],['i>as','n>as:2','i>ar','s>ar:2','s>n','as>s','ar>s:2','s>o']);
  const r=runOut(tog,[['in',0,1],['scan',1],['print'],['scan',1],['print'],['scan',1],['print'],['scan',1],['print']]);
  check('Cap.11.4 toggle sin R_TRIG oscila mientras el pulsador está presionado: la salida cambia en cada scan (FW y SIM)',new Set(r.f.map(x=>x[0])).size===2&&r.f.every((x,i)=>i===0||x[0]!==r.f[i-1][0])&&eqj(r.f,r.s),r.f.map(x=>x[0]).join(''));
  findings.push({id:'11.4-toggle',title:'Toggle sin R_TRIG',status:'ADVERTENCIA',expected:[],obtained:r.f,note:'Confirmado que oscila en cada scan; el manual dice "100 Hz": con scan de 10 ms la salida cambia 50 veces por segundo (ciclo completo 20 ms = 50 Hz).'}); }
// 11.4: TON con PT vacío o ausente => dispara inmediatamente
{ const mk=(d)=>P([['i','input1'],['t','ton',d],['o','output1']],['i>t','t>o']);
  const r0=runOut(mk({time:'0'}),[['in',0,1],['scan',3],['print']]);
  const rE=runOut(mk({time:''}),[['in',0,1],['scan',3],['print']]);
  const rN=runOut(mk({}),[['in',0,1],['scan',3],['print']]);
  check('Cap.11.4/11.7 TON con PT=0, vacío o ausente activa la salida de inmediato (FW y SIM)',[r0,rE,rN].every(r=>r.f[0][0]==='1'&&eqj(r.f,r.s)),[r0,rE,rN].map(r=>r.f[0][0]).join(''));
  findings.push({id:'11.4-pt',title:'TON con PT 0/vacío',status:'OK',expected:[],obtained:[],note:'Confirmado: activa de inmediato.'}); }
// 11.4: PWM + salida digital en el mismo OUT: la salida digital se ignora en hardware (el simulador la refleja, se normaliza)
{ const p=P([['a','analog1'],['w','pwm',{out:'0',value:'0'}],['i','input1'],['o','output1']],['a>w','i>o']);
  const r=runOut(p,[['in',0,1],['ai',0,2048],['scan',3],['print']]);
  const pw=r.raw.fw.find(l=>l.startsWith('OUT')).split('PWM ')[1].split(' ').map(Number);
  check('Cap.11.4 PWM y salida digital sobre el mismo OUT: el programa entrega PWM=2048 en el canal (la exclusión de la digital está en plc_io.cpp: solo verificable en hardware)',pw[0]===2048,r.raw.fw.join('|'));
  findings.push({id:'11.4-pwm',title:'PWM + digital en el mismo OUT',status:'OK',expected:[],obtained:[],note:'plc_io.cpp (lectura de código, NO ejecutado en host): plcWriteOutput ignora el pin bajo PWM; verificar en el ESP32. El simulador refleja también el bit digital del mismo canal (diferencia cosmética conocida que no afecta al PWM).'}); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
