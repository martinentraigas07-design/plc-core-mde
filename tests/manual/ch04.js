'use strict';
process.env.CH='4';
const {P,step,seq,manualEx,ladderNote,check,runOut,findings}=require('./dsl');
const H=require('../harness');
const adv=ms=>[['adv',ms],['scan',1],['print']];
const same=(id,desc,prog,st,exp)=>{const r=runOut(prog,st);const ok=JSON.stringify(r.f)===JSON.stringify(r.s)&&(!exp||JSON.stringify(r.f)===JSON.stringify(exp));
  check(`Ej ${id} ${desc} (FW==SIM${exp?' y = tabla':''})`,ok,r.f.join(',')+' | SIM '+r.s.join(','));findings.push({id,title:desc,status:ok?'OK':'FALLA',expected:exp||[],obtained:r.f});return r;};
// 4.1 TON 5000: SR + TON + OUT. Paro NC -> con NOT
const ton=P([['i1','input1'],['i2','input2'],['pn','not'],['s','sr'],['t','ton',{time:'5000'}],['o','output1']],['i1>s','i2>pn','pn>s:2','s>t','t>o']);
const s41=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(4000),adv(1200),step({0:0,1:0}),
  step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(2000),step({0:0,1:0}));   // cae antes de PT
same('4.1','TON 5 s con paro NC',ton,s41,['0000','0000','0000','0000','1000','0000','0000','0000','0000','0000','0000']);
ladderNote('4.1',ton,s41);
// 4.2 TOF 30000: SR -> OUT2 y TOF -> OUT1. Tabla del manual usa IN2 NC (inicio IN2=1?) -> usamos NOT
const tof=P([['i1','input1'],['i2','input2'],['pn','not'],['s','sr'],['t','tof',{time:'30000'}],['o1','output1'],['o2','output2']],
  ['i1>s','i2>pn','pn>s:2','s>t','t>o1','s>o2']);
const s42=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),step({0:0,1:0}),adv(10000),adv(19000),adv(2000));
same('4.2','TOF 30 s (motor inmediato, ventilador +30 s)',tof,s42,['0000','1100','1100','1000','1000','1000','0000']);
// 4.3 TP 15000 (semáforo): TP(IN1)->M1 ; OUT1=M1 ; OUT2=NOT M1 ; TON3000(IN1)->OUT3
const tp=P([['i1','input1'],['p','tp',{time:'15000'}],['n','not'],['t','ton',{time:'3000'}],['o1','output1'],['o2','output2'],['o3','output3']],
  ['i1>p','p>o1','p>n','n>o2','i1>t','t>o3']);
const s43=seq(step({0:0}),step({0:1}),step({0:0}),adv(5000),step({0:1}),adv(3500),adv(8000),adv(2000),step({0:0}));
same('4.3','TP 15 s + TON 3 s peatón',tp,s43,null);
{ const r=runOut(tp,s43);
  // propiedad: pulso rojo exacto, 2º presión no re-dispara, verde vehículos opuesto
  const red=r.f.map(x=>x[0]), grn=r.f.map(x=>x[1]);
  check('Ej 4.3 OUT1 y OUT2 siempre opuestos',r.f.every(x=>x[0]!==x[1]),r.f.join(','));
  check('Ej 4.3 pulso rojo se mantiene tras soltar IN1 (no depende de la duración de EN)',r.f[2]==='1000'||r.f[2].startsWith('1'),r.f.join(',')); }
ladderNote('4.3',tp,s43);
{const dd=require('./dsl'),IC=require('../../js/compiler/ir_check.js');const ir=dd.C.compileFBD(tp);
 const cv=dd.D.convertIRToLadder(ir,{compile:dd.C.compileLadder,check:IC});
 check('Ej 4.3 NOT(TP.Q) ahora SÍ se convierte (contacto [/T0] sobre la Q del bloque) y queda verificado',cv.ok&&cv.verified,cv.ok?'':cv.reasons.join('|').slice(0,120));}
// 4.4 BLINK 1000 y 250 con SR
const bl=P([['i1','input1'],['i2','input2'],['s','sr'],['b','blink',{time:'1000'}],['o','output1']],['i1>s','i2>s:2','s>b','b>o']);
{ const st=seq(step({0:1,1:0}),step({0:0,1:0}),adv(600),adv(600),adv(600),adv(600));
  const r=runOut(bl,st);
  check('Ej 4.4 BLINK 1 s: FW==SIM y alterna', JSON.stringify(r.f)===JSON.stringify(r.s)&&new Set(r.f).size===2,r.f.join(',')+' | SIM '+r.s.join(',')); }
// EN=0 => Q=0 (diagrama)
{ const st=seq(step({0:1,1:0}),adv(600),step({0:0,1:1}),adv(600),adv(600));
  const r=runOut(bl,st);
  check('Ej 4.4 BLINK con EN=0 queda en 0 (FW==SIM)',JSON.stringify(r.f)===JSON.stringify(r.s)&&r.f.slice(-3).every(x=>x==='0000'),r.f.join(',')+' | SIM '+r.s.join(',')); }
findings.push({id:'4.4',title:'BLINK',status:'OK',expected:[],obtained:[],note:'El manual dice que BLINK es Level 2 en Ladder; el decompilador del repo lo clasifica como nivel 3 (rechazado, no mal traducido). Texto del manual a ajustar.'});

// 4.6 alarma por tiempo: SR(S=IN1,R=IN2) -> OUT1 ; Q -> TON 300000 -> OUT2
const p46=P([['i1','input1'],['i2','input2'],['s','sr'],['t','ton',{time:'300000'}],['o1','output1'],['o2','output2']],['i1>s','i2>s:2','s>o1','s>t','t>o2']);
{ const ev=seq(step({0:0,1:0}),step({0:1,1:0}),step({0:0,1:0}),adv(100000),adv(150000),adv(60000),step({0:0,1:1}),adv(1000));
  const r=runOut(p46,ev);const g=r.f.map(x=>x.slice(0,2));
  check('Ej 4.6 (sensor momentáneo) bomba ON, alarma a los 5 min y reset con IN2 (FW y SIM)',
    JSON.stringify(g)===JSON.stringify(['00','10','10','10','10','11','00','00'])&&JSON.stringify(r.f)===JSON.stringify(r.s),g.join(','));
  const lvl=runOut(p46,seq(step({0:1,1:0}),adv(299000),adv(2000),step({0:1,1:1}),adv(1000)));
  const gl=lvl.f.map(x=>x.slice(0,2));
  check('Ej 4.6 [HALLAZGO] con nivel bajo sostenido (IN1=1, lo normal) IN2 NO puede resetear la alarma: SR es set-dominante (FW y SIM)',gl[gl.length-1]==='11'&&JSON.stringify(lvl.f)===JSON.stringify(lvl.s),gl.join(','));
  findings.push({id:'4.6',title:'Alarma por tiempo (TON de seguridad)',status:'DEFECTO_MANUAL',expected:[],obtained:gl,note:'El FBD usa SR (set dominante) con S=IN1 (nivel bajo, señal sostenida) y R=IN2: mientras el nivel siga bajo el operario no puede resetear con IN2. Usar RS (reset dominante) como pide el propio Cap. 8. El Ladder del ejemplo pone IN2 como NC en SET/RESET (distinto del FBD: IN2 NA como R).'}); }
// 4.5 SR -> TON3000 -> TOF5000 -> OUT1 (paro NC)
const mo=P([['i1','input1'],['i2','input2'],['pn','not'],['s','sr'],['t','ton',{time:'3000'}],['f','tof',{time:'5000'}],['o','output1']],['i1>s','i2>pn','pn>s:2','s>t','t>f','f>o']);
const s45=seq(step({0:0,1:1}),step({0:1,1:1}),step({0:0,1:1}),adv(2000),adv(1500),step({0:0,1:0}),adv(3000),adv(2500));
same('4.5','Retardo arranque 3 s / paro 5 s',mo,s45,['0000','0000','0000','0000','1000','1000','1000','0000']);
ladderNote('4.5',mo,s45);
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
