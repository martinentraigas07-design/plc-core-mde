'use strict';
// E5 — Ejemplos corregidos del manual v3: cada circuito se ejecuta en el firmware compilado en host (FW) y en el simulador (SIM);
// las tablas de estados del manual se generan a partir de estas ejecuciones (no son valores inventados).
// Ninguna prueba se ejecutó en hardware ESP32. Escribe man_results/e5_results.json si se define E5_OUT.
const path=require('path'),fs=require('fs');
const {P,both,dig,H,C,D}=require('./manual/dsl');
const IC=require(path.join(process.env.REPO||path.resolve(__dirname,'..'),'js/compiler/ir_check.js'));
const {check}=H; console.warn=()=>{};console.info=()=>{};
const RES={};
function relabel(prog,perm){const d=prog.drawflow.Home.data,o={};for(const k in d){const n=JSON.parse(JSON.stringify(d[k]));n.id=perm[+k];
  for(const p in n.outputs)n.outputs[p].connections.forEach(c=>c.node=String(perm[+c.node]));o[String(perm[+k])]=n;}return {drawflow:{Home:{data:o}}};}

const lad=(prog)=>{const ir=C.compileFBD(prog);const r=D.convertIRToLadder(ir,{compile:C.compileLadder,check:IC});
  return r.ok?{ok:true,verified:!!r.verified,marks:(r.marks||[]).length}:{ok:false,why:(r.reasons||[]).join(' | ').slice(0,200)};};
// rows: [{l,in:{0:v,1:v},adv:ms,ai:v}] ; devuelve las salidas de cada fila (FW==SIM exigido)
function run(id,title,prog,rows,expect,opts){
  opts=opts||{};const steps=[];
  rows.forEach(r=>{if(r.pulse){for(let k=0;k<r.pulse[1];k++)steps.push(['in',r.pulse[0],1],['scan',2],['in',r.pulse[0],0],['scan',2]);}Object.entries(r.in||{}).forEach(([k,v])=>steps.push(['in',+k,v]));if(r.ai!==undefined)steps.push(['ai',0,r.ai]);if(r.adv)steps.push(['adv',r.adv]);steps.push(['scan',3],['print']);});
  const R=both(prog,steps),f=R.fw.filter(l=>l.startsWith('OUT')).map(dig),s=R.sim.filter(l=>l.startsWith('OUT')).map(dig);
  const eq=JSON.stringify(f)===JSON.stringify(s);
  check(`E5 ${id} ${title}: firmware(host) == simulador en ${rows.length} filas`,eq,eq?f.join(','):'FW '+f.join(',')+' | SIM '+s.join(','));
  if(expect){const ok=JSON.stringify(f)===JSON.stringify(expect);check(`E5 ${id} ${title}: salidas = diseño esperado`,ok,ok?'':`esperado ${expect.join(',')} | obtenido ${f.join(',')}`);}
  const L=opts.noLadder?{ok:false,why:'no evaluado'}:lad(prog);
  RES[id]={title,rows:rows.map((r,i)=>({l:r.l,in:r.in||{},adv:r.adv||0,ai:r.ai,out:f[i]})),ladder:L};
  return f;
}
const rs=(extra)=>P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['o','output1'],...(extra?extra.nodes:[])],['i1>s','i2>n','n>s:2','s>o',...(extra?extra.links:[])]);
// ── 2.1 Arranque/paro, paro NC: RS(S=IN1, R=NOT IN2) ──
run('2.1','Arranque/paro con paro NC',rs(),[
  {l:'Reposo (IN2 NC cerrado)',in:{0:0,1:1}},{l:'Pulsar ARRANQUE',in:{0:1,1:1}},{l:'Soltar ARRANQUE',in:{0:0,1:1}},
  {l:'Pulsar PARO (NC abre)',in:{0:0,1:0}},{l:'Soltar PARO',in:{0:0,1:1}},{l:'ARRANQUE de nuevo',in:{0:1,1:1}},{l:'Soltar ARRANQUE',in:{0:0,1:1}},
  {l:'Cable de PARO cortado',in:{0:0,1:0}},{l:'ARRANQUE con el cable de PARO cortado',in:{0:1,1:0}}],
  ['0000','1000','1000','0000','0000','1000','1000','0000','0000']);
// ── 2.3/3.5/8.1 Cadena de seguridad: IN1 = cadena NC en serie (1 = OK), IN2 = INICIO/rearme NA. RS(S=IN2, R=NOT IN1) ──
const cad=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['o','output1']],['i2>s','i1>n','n>s:2','s>o']);
run('2.3','Cadena de seguridad NC + inicio',cad,[
  {l:'Cadena OK, sin pulsar INICIO',in:{0:1,1:0}},{l:'Pulsar INICIO',in:{0:1,1:1}},{l:'Soltar INICIO (sigue en marcha)',in:{0:1,1:0}},
  {l:'EMERGENCIA presionada (cadena abre)',in:{0:0,1:0}},{l:'Cadena cierra de nuevo, sin INICIO (no rearma solo)',in:{0:1,1:0}},
  {l:'Pulsar INICIO con la cadena OK (rearme)',in:{0:1,1:1}},{l:'Soltar INICIO',in:{0:1,1:0}},
  {l:'INICIO pulsado mientras la emergencia sigue activa',in:{0:0,1:1}},{l:'Cable de la cadena cortado',in:{0:0,1:0}}],
  ['0000','1000','1000','0000','0000','1000','1000','0000','0000']);
// ── 3.1 SR (Set domina) con lámparas opuestas, paro NC: SR(S=IN1, R=NOT IN2), OUT2=NOT Q ──
const sr31=P([['i1','input1'],['i2','input2'],['n','not'],['s','sr'],['o1','output1'],['q','not'],['o2','output2']],['i1>s','i2>n','n>s:2','s>o1','s>q','q>o2']);
run('3.1','SR con lámparas opuestas',sr31,[
  {l:'Reposo',in:{0:0,1:1}},{l:'Pulsar IN1 (arranque)',in:{0:1,1:1}},{l:'Soltar IN1',in:{0:0,1:1}},
  {l:'Pulsar PARO (IN2 NC abre)',in:{0:0,1:0}},{l:'Conflicto: IN1 y PARO a la vez (SET gana)',in:{0:1,1:0}}],
  ['0100','1000','1000','0100','1000']);
// ── 3.2 RS (Reset domina), paro NC: RS(S=IN1, R=NOT IN2) ──
run('3.2','RS prioridad de reset',rs(),[
  {l:'Reposo',in:{0:0,1:1}},{l:'Arranque normal',in:{0:1,1:1}},{l:'Soltar',in:{0:0,1:1}},{l:'Conflicto: IN1 y PARO a la vez (RESET gana)',in:{0:1,1:0}},{l:'PARO solo',in:{0:0,1:0}}],
  ['0000','1000','1000','0000','0000']);
// ── 4.6 Timeout de llenado: RS(S=IN1 nivel bajo, R=IN2 nivel alto) + TON 300000 ms sobre Q ──
const p46=P([['i1','input1'],['i2','input2'],['s','rs'],['t','ton',{time:'300000'}],['o1','output1'],['o2','output2']],['i1>s','i2>s:2','s>o1','s>t','t>o2']);
run('4.6','Alarma por tiempo (timeout) con RS',p46,[
  {l:'Nivel normal',in:{0:0,1:0}},{l:'Nivel bajo: arranca la bomba',in:{0:1,1:0}},{l:'Nivel empieza a subir (bomba sigue)',in:{0:0,1:0}},{l:'Pasan 2 min',adv:120000},
  {l:'Llega a nivel alto (IN2): llenado exitoso',in:{0:0,1:1}},{l:'Nivel vuelve a bajar',in:{0:1,1:0}},{l:'Pasan 4 min',adv:240000},{l:'Pasan 1 min más (5 min)',adv:61000},
  {l:'Sensor de nivel alto: la bomba se detiene',in:{0:0,1:1}}],
  ['0000','1000','1000','1000','0000','1000','1000','1100','0000']);
// ── 7.1 Motor con retardo de arranque 3 s: RS(S=IN1,R=NOT IN2) → TON 3000 → K1, verde = Q_TON, roja = NOT Q_TON ──
const p71=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','ton',{time:'3000'}],['o1','output1'],['o2','output2'],['q','not'],['o3','output3']],
  ['i1>s','i2>n','n>s:2','s>t','t>o1','t>o2','t>q','q>o3']);
run('7.1','Motor con contactor y retardo de arranque',p71,[
  {l:'Reposo',in:{0:0,1:1}},{l:'Pulsar ARRANQUE',in:{0:1,1:1}},{l:'Soltar ARRANQUE (cuenta el retardo)',in:{0:0,1:1}},{l:'A los 3 s',adv:3100},
  {l:'Pulsar PARO',in:{0:0,1:0}},{l:'Soltar PARO',in:{0:0,1:1}},{l:'ARRANQUE y PARO antes de 3 s',in:{0:1,1:1}},{l:'PARO',in:{0:0,1:0}},{l:'Cable de PARO cortado',in:{0:0,1:0}}],
  ['0010','0010','0010','1100','0010','0010','0010','0010','0010']);
// ── 7.2 Estrella-triángulo: K1=Q_SR, K2=Q_SR·NOT Q_TON8, K3=TON(100ms) sobre Q_TON8 (tiempo muerto) ──
const p72=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','ton',{time:'8000'}],['nt','not'],['k2','and'],['d','ton',{time:'100'}],['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>s','i2>n','n>s:2','s>o1','s>t','t>nt','s>k2','nt>k2:2','k2>o2','t>d','d>o3']);
run('7.2','Estrella-triángulo con tiempo muerto',p72,[
  {l:'Parado',in:{0:0,1:1}},{l:'ARRANQUE: K1 y K2 (estrella)',in:{0:1,1:1}},{l:'Soltar ARRANQUE (7,9 s, estrella)',in:{0:0,1:1},adv:7900},{l:'A los 8,05 s: K2 abre y K3 aún no cierra',adv:150},
  {l:'A los 8,2 s: K3 cierra (triángulo)',adv:150},{l:'PARO',in:{0:0,1:0}},{l:'Soltar PARO',in:{0:0,1:1}}],
  ['0000','1100','1100','1000','1010','0000','0000']);
// ── 7.3 Semáforo peatonal: TP 20 s en IN1; TON 3 s alimentado por Q_TP; verde peatón = TON·Q_TP ──
const p73=P([['i1','input1'],['p','tp',{time:'20000'}],['n','not'],['t','ton',{time:'3000'}],['a','and'],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['i1>p','p>n','n>o2','p>o1','p>t','t>a','p>a:2','a>o3','a>o4']);
run('7.3','Semáforo peatonal',p73,[
  {l:'Estado normal (verde vehicular)',in:{0:0}},{l:'Pulsar y soltar el botón (pulso breve)',in:{0:1}},{l:'Botón suelto (rojo vehicular en curso)',in:{0:0}},{l:'A los 3,1 s',adv:3100},
  {l:'A los 15 s (nuevo pulso ignorado)',in:{0:1},adv:12000},{l:'A los 19,8 s (aún dentro de los 20 s)',in:{0:0},adv:4700},{l:'A los 20,3 s',adv:500}],
  ['0100','1000','1000','1011','1011','1011','0100']);
// ── 7.4 Alarma de zonas adaptada a 2 entradas: IN1 = lazo NC en serie de los sensores (1 = normal), IN2 = reconocimiento NA ──
const p74=P([['i1','input1'],['i2','input2'],['n','not'],['s','sr'],['b','blink',{time:'500'}],['o1','output1'],['o2','output2']],['i1>n','n>s','i2>s:2','s>b','b>o1','s>o2']);
run('7.4','Alarma de lazo de zonas (2 entradas)',p74,[
  {l:'Lazo normal',in:{0:1,1:0}},{l:'Se abre una zona (sensor o cable)',in:{0:0,1:0}},{l:'Pasan 600 ms (BLINK en ON)',adv:600},{l:'La zona vuelve a cerrar',in:{0:1,1:0}},
  {l:'Alarma sigue memorizada',adv:600},{l:'Operador reconoce (IN2) con el lazo cerrado',in:{0:1,1:1}},{l:'Suelta IN2',in:{0:1,1:0}}],null);
// ── 8.2 Cintas enclavadas adaptadas a 2 entradas: IN1 arranque C1 (paro NC no disponible: IN2=paro NC común); C2 = Q1 con retardo de paro TOF 3 s ──
const p82=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['f','tof',{time:'3000'}],['o1','output1'],['o2','output2']],['i1>s','i2>n','n>s:2','s>o1','s>f','f>o2']);
run('8.2','Cintas enclavadas (C2 sigue a C1)',p82,[
  {l:'Reposo',in:{0:0,1:1}},{l:'ARRANQUE: C1 y C2 arrancan',in:{0:1,1:1}},{l:'Soltar',in:{0:0,1:1}},{l:'PARO (C1 se detiene)',in:{0:0,1:0}},{l:'1 s después',adv:1000},
  {l:'3,1 s después del paro',adv:2200}],['0000','1100','1100','0100','0100','0000']);
// ── 8.3 Timeout de válvula: RS(S=IN1, R=OR(IN2 nivel alto, Q_TON)) + TON 180000; alarma enclavada con SR(S=Q_TON, R=IN1) ──
const p83=P([['i1','input1'],['i2','input2'],['o','or'],['s','rs'],['t','ton',{time:'180000'}],['al','sr'],['o1','output1'],['o2','output2']],
  ['i1>s','i2>o','t>o:2','o>s:2','s>t','s>o1','t>al','i1>al:2','al>o2']);
run('8.3','Timeout de seguridad con alarma enclavada',p83,[
  {l:'Reposo',in:{0:0,1:0}},{l:'Pulsar INICIO: abre la válvula',in:{0:1,1:0}},{l:'Soltar INICIO',in:{0:0,1:0}},{l:'Pasan 100 s',adv:100000},{l:'Nivel alto antes de 3 min: cierra',in:{0:0,1:1}},
  {l:'Nuevo INICIO (nivel alto liberado)',in:{0:1,1:0}},{l:'Soltar INICIO',in:{0:0,1:0}},{l:'Pasan 3 min sin nivel alto (falla)',adv:181000},{l:'La válvula ya está cerrada; la alarma sigue',adv:5000},
  {l:'Nuevo INICIO: rearma y borra la alarma',in:{0:1,1:0}}],
  ['0000','1000','1000','1000','0000','1000','1000','0100','0100','1000']);
// ── 10.4 Bomba con protecciones: presión con SCALE 0–100 (décimas de bar), CMP<5 (0,5 bar) ──
const p104=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'100'}],['lo','cmp',{op:'<',value:'5'}],['i1','input1'],['r','rs'],['o1','output1'],['o2','output2']],
  ['a>s','s>lo','i1>r','lo>r:2','r>o1','lo>o2']);
RES['10.4_nota']={nota:'ejemplo reducido para verificar la corrección del umbral CMP<5 con SCALE 0–100'};
run('10.4','Protección por presión baja (SCALE 0–100 = décimas de bar)',p104,[
  {l:'Presión normal (5,0 bar), INICIO',in:{0:1},ai:2048},{l:'Soltar INICIO',in:{0:0},ai:2048},{l:'Presión 0,6 bar',ai:246},{l:'Presión 0,4 bar (< 0,5)',ai:164},{l:'Presión vuelve a 5 bar, sin INICIO',ai:2048}],
  ['1000','1000','1000','0100','0000']);

// ── 8.3 contiene un lazo con 2 bloques con memoria (TON→OR→RS→TON): se mide si las filas de la tabla dependen de los ID ──
{ const rows83=RES['8.3'].rows,st=[];rows83.forEach(r=>{Object.entries(r.in||{}).forEach(([k,v])=>st.push(['in',+k,v]));if(r.adv)st.push(['adv',r.adv]);st.push(['scan',3],['print']);});
  const base=both(p83,st).fw.filter(l=>l.startsWith('OUT')).map(dig).join('|');
  const ids=Object.keys(p83.drawflow.Home.data).map(Number);let s0=12345;const rnd=()=>{s0=(Math.imul(s0,1664525)+1013904223)>>>0;return s0/4294967296;};let diff=0;const T=40;
  for(let t=0;t<T;t++){const p=ids.slice();for(let i=p.length-1;i>0;i--){const j=(rnd()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}const perm={};ids.forEach((id,i)=>perm[id]=p[i]);
    if(both(relabel(p83,perm),st).fw.filter(l=>l.startsWith('OUT')).map(dig).join('|')!==base)diff++;}
  RES['8.3'].idPermutations={tested:T,changed:diff};
  check(`E5 8.3 sensibilidad al orden de ID (lazo con 2 bloques con memoria): ${diff}/${T} renumeraciones cambian alguna fila de la tabla`,true,`${diff}/${T}`);
}

// ── 8.4 Reset con confirmación de 2 s (adaptado a 2 entradas): IN1 = lazo NC del sensor (1 = normal), IN2 = botón de reset (mantener 2 s) ──
const p84=P([['i1','input1'],['i2','input2'],['n','not'],['t','ton',{time:'2000'}],['s','sr'],['o','output1']],['i1>n','n>s','i2>t','t>s:2','s>o']);
run('8.4','Alarma con reset por pulsación sostenida de 2 s',p84,[
  {l:'Lazo normal',in:{0:1,1:0}},{l:'El sensor abre el lazo: alarma ON',in:{0:0,1:0}},{l:'Se pulsa reset un instante (0,5 s)',in:{0:0,1:1},adv:500},{l:'Se suelta el reset',in:{0:0,1:0}},
  {l:'Reset sostenido 2,2 s con el sensor aún abierto (set domina)',in:{0:0,1:1},adv:2200},{l:'El lazo vuelve a normal',in:{0:1,1:1}},{l:'Reset sostenido 2,2 s con el lazo normal',adv:2200},{l:'Soltar reset',in:{0:1,1:0}}],
  ['0000','1000','1000','1000','1000','1000','0000','0000']);
// ── 8.5 Prensa (ejercicio didáctico): IN1 = cadena NC, IN2 = INICIO/rearme NA. RS(S=IN2,R=NOT IN1) → TON 3 s → K1/verde; amarilla = RS·NOT Q_TON; CTU (PV=3 en la prueba) cuenta INICIOS ──
const p85=P([['i1','input1'],['i2','input2'],['n','not'],['s','rs'],['t','ton',{time:'3000'}],['nt','not'],['am','and'],['c','ctu',{value:'3'}],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['i2>s','i1>n','n>s:2','s>t','t>o1','t>o3','t>nt','s>am','nt>am:2','am>o2','i2>c','c>o4']);
run('8.5','Prensa didáctica: cadena NC, rearme, retardo y contador de ciclos',p85,[
  {l:'Cadena OK, parada',in:{0:1,1:0}},{l:'INICIO: espera de 3 s (amarilla)',in:{0:1,1:1}},{l:'Soltar INICIO',in:{0:1,1:0}},{l:'A los 3,1 s: contactor y verde',adv:3100},
  {l:'EMERGENCIA',in:{0:0,1:0}},{l:'Cadena cierra: no rearma sola',in:{0:1,1:0}},{l:'INICIO (2.º ciclo)',in:{0:1,1:1}},{l:'Soltar y esperar 3,1 s',in:{0:1,1:0},adv:3100},
  {l:'EMERGENCIA',in:{0:0,1:0}},{l:'Cadena OK',in:{0:1,1:0}},{l:'INICIO (3.er ciclo): el contador llega a 3',in:{0:1,1:1}},{l:'Soltar y esperar 3,1 s',in:{0:1,1:0},adv:3100}],
  ['0000','0100','0100','1010','0000','0000','0100','1010','0000','0000','0101','1011']);
// ── 10.5 Mezcla (corregida): receta enclavada con RS, mezcla 30 s, descarga TP 5 s, reset de los CTU con F_TRIG de la descarga. (≥2 bloques con memoria en el lazo) ──
const p105=P([['i1','input1'],['i2','input2'],['ra','r_trig'],['rb','r_trig'],['ca','ctu',{value:'10'}],['cb','ctu',{value:'5'}],['ar','and'],['L','rs'],['n','not'],['td','ton',{time:'30000'}],['tp5','tp',{time:'5000'}],['ff','f_trig'],['nm','not'],['am','and'],['o1','output1'],['o2','output2'],['o3','output3'],['o4','output4']],
  ['i1>ra','ra>ca','i2>rb','rb>cb','ca>ar','cb>ar:2','ar>L','ff>L:2','L>n','n>o1','n>o2','L>td','td>tp5','tp5>o4','tp5>ff','ff>ca:2','ff>cb:2','td>nm','nm>am','L>am:2','am>o3']);
run('10.5','Mezcla automatizada (versión corregida)',p105,[
  {l:'Inicio: cintas A y B en marcha',in:{0:0,1:0}},{l:'10 unidades de A (IN1)',pulse:[0,10]},{l:'5 unidades de B (IN2): receta completa',pulse:[1,5]},{l:'A los 29 s: mezclando',adv:29000},
  {l:'A los 31 s: termina la mezcla, abre la descarga',adv:2000},{l:'A los 35,5 s: descargando',adv:4500},{l:'A los 36,5 s: fin de descarga, reinicio automático',adv:1000}],
  ['1100','1100','0010','0010','0001','0001','1100']);
{ const rows=RES['10.5'].rows,st=[];rows.forEach(r=>{if(r.pulse){}});
  const st2=[['in',0,0],['scan',3],['print']];for(let k=0;k<10;k++)st2.push(['in',0,1],['scan',2],['in',0,0],['scan',2]);st2.push(['print']);
  for(let k=0;k<5;k++)st2.push(['in',1,1],['scan',2],['in',1,0],['scan',2]);st2.push(['print'],['adv',29000],['scan',3],['print'],['adv',2000],['scan',3],['print'],['adv',4500],['scan',3],['print'],['adv',1000],['scan',3],['print']);
  const base=both(p105,st2).fw.filter(l=>l.startsWith('OUT')).map(dig).join('|');
  const ids=Object.keys(p105.drawflow.Home.data).map(Number);let s0=777;const rnd=()=>{s0=(Math.imul(s0,1664525)+1013904223)>>>0;return s0/4294967296;};let diff=0;const T=40;
  for(let t=0;t<T;t++){const p=ids.slice();for(let i=p.length-1;i>0;i--){const j=(rnd()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}const perm={};ids.forEach((id,i)=>perm[id]=p[i]);
    if(both(relabel(p105,perm),st2).fw.filter(l=>l.startsWith('OUT')).map(dig).join('|')!==base)diff++;}
  RES['10.5'].idPermutations={tested:T,changed:diff};
  check(`E5 10.5 sensibilidad al orden de ID: ${diff}/${T} renumeraciones cambian alguna salida muestreada`,true,`${diff}/${T}`);
}
// ── Contadores: CTU cuenta flancos sin R_TRIG ──
const ctu=P([['i1','input1'],['i2','input2'],['c','ctu',{value:'5'}],['o','output1']],['i1>c','i2>c:2','c>o']);
const hold=[];for(let k=0;k<5;k++){hold.push({l:`Pulso ${k+1}: IN1=1 durante 3 scans`,in:{0:1}},{l:`Soltar IN1`,in:{0:0}});}
run('5.regla','CTU sin R_TRIG: cuenta un pulso por flanco',ctu,hold,['0000','0000','0000','0000','0000','0000','0000','0000','1000','1000']);
// ── Salida PWM: valor lógico vs duty ──
const pw=P([['a','analog1'],['s','scale',{inMin:'0',inMax:'4095',outMin:'0',outMax:'4095'}],['w','pwm',{out:'0',value:'0'}]],['a>s','s>w']);
RES['6.1']={title:'AI1→SCALE→PWM',ladder:lad(pw)};
// ── Estado de conversión Ladder de los ejemplos con realimentación (E4c) ──
const {spawnSync}=require('child_process');const os=require('os');
const corpus={};for(const c of ['ch01_03','ch04','ch05','ch06','ch07','ch08','ch10','ch11_5box']){const fn=path.join(os.tmpdir(),'e5_'+process.pid+'_'+c+'.json');
  spawnSync('node',[path.join(__dirname,'manual',c+'.js')],{env:Object.assign({},process.env,{E4_CORPUS_OUT:fn})});
  JSON.parse(fs.readFileSync(fn)).forEach((e,i)=>corpus[c+'#'+(i+1)]=e.prog);fs.unlinkSync(fn);}
RES.feedback={};
for(const nm of ['ch01_03#7','ch01_03#17','ch11_5box#2','ch05#6','ch01_03#10','ch08#6','ch08#7','ch10#6']){RES.feedback[nm]=lad(corpus[nm]);}
check('E5 realimentación: 4 convertibles (un solo bloque con memoria) y 4 rechazados (varios bloques con memoria)',
  ['ch01_03#7','ch01_03#17','ch11_5box#2','ch05#6'].every(n=>RES.feedback[n].ok)&&['ch01_03#10','ch08#6','ch08#7','ch10#6'].every(n=>!RES.feedback[n].ok));
if(process.env.E5_OUT){fs.writeFileSync(process.env.E5_OUT,JSON.stringify(RES,null,1));}
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
