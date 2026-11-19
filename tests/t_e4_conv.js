'use strict';
// E4.1/E4.2 — FBD → Ladder → FBD sobre (a) todos los programas del manual, (b) corpus por característica,
// (c) programas aleatorios acíclicos. Comparación FW(host) vs SIM con estados internos, PWM y límites temporales.
// NO es una prueba formal de equivalencia: es diferencial (secuencias deterministas), más el oráculo ir_check.
const path=require('path'), fs=require('fs'), os=require('os'), {spawnSync}=require('child_process');
const R=process.env.REPO||path.resolve(__dirname,'..');
const H=require('./harness'); const {program,runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const IC=require(path.join(R,'js/compiler/ir_check.js'));
const OPTS={compile:C.compileLadder,check:IC};
const N=(id,name,data)=>({id,name,data:data||{}});
const STATEFUL=['ton','tof','tp','blink','ctu','ctd','r_trig','f_trig','sr','rs','scale','pwm'];
const PARAM={ton:n=>n.preset,tof:n=>n.preset,tp:n=>n.preset,blink:n=>n.preset,ctu:n=>n.value,ctd:n=>n.value,
  cmp:n=>n.op+':'+n.value+':'+(n.in2||''),scale:n=>[n.scaleInMin,n.scaleInMax,n.scaleOutMin,n.scaleOutMax].join(','),pwm:n=>n.outIdx};
const INV={'>':'<=','<':'>=','>=':'<','<=':'>','==':'!=','!=':'=='};

// ───────── generador de estímulos ─────────
function lcg(seed){let s=seed>>>0||1;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function stimulus(presets,seed,len){
  const rnd=lcg(seed),st=[];const AIV=[0,1,2047,2048,2049,3000,4094,4095];
  const sc=(dt)=>{ if(dt>0)st.push(['adv',dt]); st.push(['scan',1]); st.push(['print']); st.push(['@nodes']); };
  // arranque: todo en 0, y luego ambas entradas en 1 desde el primer scan
  st.push(['in',0,0],['in',1,0],['ai',0,0]); sc(0); sc(0);
  st.push(['in',0,1],['in',1,1],['ai',0,4095]); sc(0); sc(0); st.push(['in',0,0],['in',1,0],['ai',0,0]); sc(0);
  // set/reset simultáneos y liberación en ambos órdenes
  for(const ord of [[0,1],[1,0]]){ st.push(['in',0,1],['in',1,1]); sc(0); sc(0); st.push(['in',ord[0],0]); sc(0); sc(0); st.push(['in',ord[1],0]); sc(0); sc(0); }
  // límites temporales: para cada preset, mantener cada entrada y cruzar p-10, p, p+10 (±1 scan)
  const ps=[...new Set(presets.filter(p=>p>0&&p<=5000))].sort((a,b)=>a-b);
  for(const p of ps) for(const ix of [0,1]){
    st.push(['in',ix,1]); sc(0);
    let acc=10; for(const target of [p-20,p-10,p-1,p,p+1,p+10,p+30]){ if(target<=acc)continue; sc(target-acc-10<0?0:target-acc-10); acc=target; }
    st.push(['in',ix,0]); sc(0); sc(p+20);
    // pulso corto (menos que el preset) y rebote
    st.push(['in',ix,1]); sc(0); st.push(['in',ix,0]); sc(0); st.push(['in',ix,1]); sc(0); sc(Math.max(0,p-30)); st.push(['in',ix,0]); sc(0); sc(p+10);
  }
  // cambios rápidos: alternancia scan a scan (ráfaga) en cada entrada y en ambas
  for(let b=0;b<30;b++){ st.push(['in',0,b&1]); st.push(['in',1,(b>>1)&1]); sc(0); }
  for(let b=0;b<60;b++){ st.push(['in',0,b%3===0?1:0]); sc(0); }   // tren de pulsos (contadores/flancos)
  // analógico: barrido por los valores límite
  for(const a of AIV){ st.push(['ai',0,a]); sc(0); sc(0); }
  for(let a=0;a<=4095;a+=273){ st.push(['ai',0,a]); sc(0); }
  // aleatorio
  const DT=[0,0,0,1,10,20,50,100,250,500,1000];
  for(let k=0;k<len;k++){
    if(rnd()<0.45) st.push(['in',0,rnd()<0.5?1:0]); if(rnd()<0.45) st.push(['in',1,rnd()<0.5?1:0]);
    if(rnd()<0.2) st.push(['ai',0,rnd()<0.5?AIV[(rnd()*AIV.length)|0]:((rnd()*4096)|0)]);
    sc(DT[(rnd()*DT.length)|0]);
  }
  return st;
}
function expand(steps,ids){ const out=[]; for(const s of steps){ if(s[0]==='@nodes'){ ids.forEach(i=>out.push(['node',i])); } else out.push(s);} return out; }
function runBoth(prog,steps,ids,runner){ const e=expand(steps,ids); const lines=runner(prog,e);
  // agrupa por print: OUT + nodos
  const rows=[];let cur=null; for(const l of lines){ if(l.startsWith('OUT')){cur={out:l,nodes:{}};rows.push(cur);} else if(l.startsWith('NODE')&&cur){const m=/^NODE (\d+) \S+ state=(\d) int=(-?\d+)/.exec(l); if(m)cur.nodes[m[1]]=m[2]+'/'+m[3];} }
  return rows; }
const outKey=(l,mask)=>{const t=l.split(' ');const y=t.slice(1,5).map((v,i)=>mask.has(i)?'x':v).join('');return y+'|'+t.slice(6,10).join(',');};
function pwmPins(ir){return new Set(ir.program.nodes.filter(n=>n.type==='pwm').map(n=>n.outIdx|0));}
const presetsOf=ir=>ir.program.nodes.map(n=>n.preset|0).filter(x=>x>0);
// Nodos que deben conservarse: los bloques con estado SIEMPRE (el decompilador no borra un TON/CTU aunque nadie lea su Q);
// flancos/SCALE/CMP/compuertas sólo si alguien los consume (un flanco o comparador sin consumidor no tiene efecto observable).
function liveSet(ir){const nodes=ir.program.nodes,KEEP=['ton','tof','tp','blink','ctu','ctd','sr','rs','scale'];
  const pred={};nodes.forEach(n=>(n.outputs||[]).forEach(o=>(pred[o]=pred[o]||[]).push(n.id)));
  const live=new Set(),st=[];nodes.forEach(n=>{if(/^output/.test(n.type)||n.type==='pwm'||KEEP.includes(n.type)){live.add(n.id);st.push(n.id);}});
  while(st.length){const i=st.pop();(pred[i]||[]).forEach(p=>{if(!live.has(p)){live.add(p);st.push(p);}});}
  return live;}
const sigs=(ir,lv)=>{const m={};ir.program.nodes.filter(n=>!lv||lv.has(n.id)).forEach(n=>{if(PARAM[n.type]){const k=n.type+'('+PARAM[n.type](n)+')';m[k]=(m[k]||0)+1;}});return m;};
const cnt=(ir,t,lv)=>ir.program.nodes.filter(n=>n.type===t&&(!lv||lv.has(n.id))).length;

const REPORT=[];
// ───────── ejercicio completo ─────────
function exercise(name,prog,opt){
  opt=opt||{}; const rec={name,status:'',detail:''}; REPORT.push(rec);
  let ir; try{ir=C.compileFBD(prog);}catch(e){rec.status='OMITIDO';rec.detail='no compila como FBD: '+e.message.slice(0,80);return;}
  const cv=D.convertIRToLadder(ir,OPTS);
  if(!cv.ok){ rec.status='RECHAZADO'; rec.detail=cv.reasons.join(' | ').slice(0,300);
    check(name+': rechazo con motivo explícito (no silencioso)',cv.reasons.length>0&&!cv.rungs?.length,rec.detail.slice(0,150));
    if(opt.mustConvert) check(name+': debía convertirse',false,rec.detail.slice(0,150));
    return; }
  let l2,ir3,fail=[];
  if(opt.mutate) opt.mutate(cv.rungs);
  try{ l2=C.compileLadder({rungs:cv.rungs}); }catch(e){ rec.status='ERROR';rec.detail='recompila Ladder: '+e.message;check(name+': recompila',false,rec.detail);return; }
  if(cv.verified!==true) fail.push('oráculo no verificó');
  try{ ir3=C.compileFBD({drawflow:C.irToDrawflow(l2.program.nodes).drawflow}); }catch(e){ fail.push('Ladder→FBD: '+e.message); }
  // 1 instancia por bloque con estado y parámetros
  const lv=liveSet(ir); const dead=ir.program.nodes.filter(n=>!lv.has(n.id)&&STATEFUL.includes(n.type)).length; rec.dead=dead;
  for(const t of STATEFUL){ const a=cnt(ir,t,lv),b=cnt(l2,t);
    if(t==='rs'){ if(b<a||b>a+cv.marks.length) fail.push(`instancias rs: ${a}→${b} (marcas=${cv.marks.length})`); }
    else if(a!==b) fail.push(`instancias ${t}: ${a}→${b}`); }
  const sa=sigs(ir,lv),sb=sigs(l2);
  for(const k of Object.keys(sa)){ if(/^cmp/.test(k)){const m=/^cmp\((.*?):(.*)\)$/.exec(k); if(!(sb[k]>=1||sb['cmp('+INV[m[1]]+':'+m[2]+')']>=1)) fail.push('param '+k);} else if(sb[k]!==sa[k]) fail.push('param '+k+' '+sa[k]+'→'+sb[k]); }
  for(const k of Object.keys(sb)) if(!/^cmp/.test(k)&&sa[k]!==sb[k]) fail.push('param extra '+k);
  if(ir3){ const e3=IC.equivalent(ir,ir3,{sequences:6,length:800}); if(!e3.ok) fail.push('ir_check FBD→Ladder→FBD'); }
  // ejecución: original FW/SIM, convertido FW/SIM, ida y vuelta FW
  const p2={drawflow:C.irToDrawflow(l2.program.nodes).drawflow};
  const p3=ir3?{drawflow:C.irToDrawflow(ir3.program.nodes).drawflow}:null;
  const stim=stimulus(presetsOf(ir),1000+name.length*7+(opt.seed||0),opt.len||150);
  const idsO=ir.program.nodes.map(n=>n.id), idsC=l2.program.nodes.map(n=>n.id);
  const mask=pwmPins(ir);
  const oF=runBoth(prog,stim,idsO,runFirmware), oS=runBoth(prog,stim,idsO,runSim);
  const cF=runBoth(p2,stim,idsC,runFirmware), cS=runBoth(p2,stim,idsC,runSim);
  const tF=p3?runBoth(p3,stim,[],runFirmware):null;
  const first=(a,b,f)=>{for(let i=0;i<a.length;i++) if(f(a[i])!==f(b[i])) return i; return -1;};
  // (1) paridad de motor sobre el original: salidas (enmascarando el espejo PWM→digital del simulador), PWM y TODOS los nodos
  let i1=first(oF,oS,r=>outKey(r.out,mask)); if(i1>=0) fail.push('FW≠SIM original en salidas, paso '+i1);
  i1=first(oF,oS,r=>JSON.stringify(r.nodes)); if(i1>=0) fail.push('FW≠SIM original en estados internos, paso '+i1);
  // (2) original vs convertido (mismo motor, comparación completa)
  let i2=first(oF,cF,r=>r.out); if(i2>=0) fail.push('original≠convertido (FW) salidas/PWM, paso '+i2);
  i2=first(oS,cS,r=>r.out); if(i2>=0) fail.push('original≠convertido (SIM) salidas/PWM, paso '+i2);
  // (3) convertido FW vs SIM
  let i3=first(cF,cS,r=>outKey(r.out,mask)); if(i3>=0) fail.push('FW≠SIM convertido, paso '+i3);
  i3=first(cF,cS,r=>JSON.stringify(r.nodes)); if(i3>=0) fail.push('FW≠SIM convertido en estados internos, paso '+i3);
  // (4) ida y vuelta
  if(tF){ const i4=first(oF,tF,r=>r.out); if(i4>=0) fail.push('original≠FBD→Ladder→FBD (FW), paso '+i4); }
  // (5) estados internos de bloques con estado: pareo por (tipo, parámetros) único entre original y convertido
  let paired=0;
  {const key=(ir_,n)=>n.type+'('+(PARAM[n.type]?PARAM[n.type](n):'')+')';
   const ga={},gb={}; ir.program.nodes.filter(n=>lv.has(n.id)&&STATEFUL.includes(n.type)&&n.type!=='scale').forEach(n=>(ga[key(ir,n)]=ga[key(ir,n)]||[]).push(n.id));
   l2.program.nodes.filter(n=>STATEFUL.includes(n.type)&&n.type!=='scale').forEach(n=>(gb[key(l2,n)]=gb[key(l2,n)]||[]).push(n.id));
   for(const k of Object.keys(ga)){ if(ga[k].length!==1||!gb[k]||gb[k].length!==1) continue; paired++;
     const a=ga[k][0],b=gb[k][0];
     const idx=oF.findIndex((r,i)=>r.nodes[a]!==cF[i].nodes[b]);
     if(idx>=0){
       // el decompilador puede mover el valor interno de un latch SR/RS a una marca; sólo se exige para temporizadores/contadores/flancos/blink
       if(/^(ton|tof|tp|blink|ctu|ctd|r_trig|f_trig)/.test(k)) fail.push(`estado interno ${k} (nodo ${a}→${b}) difiere en paso ${idx}: ${oF[idx].nodes[a]} vs ${cF[idx].nodes[b]}`);
     } } }
  rec.paired=paired; rec.steps=oF.length;
  if(fail.length){ rec.status='DIFERENCIA'; rec.detail=fail.join(' ; ').slice(0,400); }
  else { rec.status='OK'; rec.detail=`${cv.rungs.length} renglones, marcas=${cv.marks.length}, ${oF.length} pasos, ${paired} bloques con estado pareados`; }
  if(opt.expectDiff){ rec.status=fail.length?'CONTROL_NEGATIVO_OK':'CONTROL_NEGATIVO_FALLA'; check(name+': el control negativo (conversión alterada a propósito) SÍ es detectado',fail.length>0,fail.join(';').slice(0,160)); return; }
  check(name+': FBD→Ladder→FBD equivalente (diferencial, FW y SIM, estados internos)',fail.length===0,rec.detail.slice(0,250));
}

// ───────── (a) corpus del manual ─────────
const corpus=[];
for(const c of ['ch01_03','ch04','ch05','ch06','ch07','ch08','ch10','ch11_5box']){
  const f=path.join(os.tmpdir(),'e4corp_'+process.pid+'_'+c+'.json');
  spawnSync('node',[path.join(__dirname,'manual',c+'.js')],{env:Object.assign({},process.env,{E4_CORPUS_OUT:f}),encoding:'utf8'});
  if(fs.existsSync(f)){ JSON.parse(fs.readFileSync(f,'utf8')).forEach((e,i)=>corpus.push({name:`manual ${c}#${i+1}`,prog:e.prog})); fs.unlinkSync(f); }
}
const seen=new Set(); const uniq=corpus.filter(e=>{const k=JSON.stringify(e.prog.drawflow);if(seen.has(k))return false;seen.add(k);return true;});
console.log(`# Corpus del manual: ${corpus.length} programas, ${uniq.length} distintos`);
uniq.forEach(e=>exercise(e.name,e.prog));

// ───────── (b) corpus por característica ─────────
const I=[N(1,'input1'),N(2,'input2')];
const FEAT=[
 ['F01 contactos NA y NC',program([...I,N(3,'output1'),N(4,'not'),N(5,'output2')],[[1,3],[1,4],[4,5]])],
 ['F02 AND/OR/NOT/XOR',program([...I,N(3,'and'),N(4,'or'),N(5,'xor'),N(6,'not'),N(7,'output1'),N(8,'output2'),N(9,'output3'),N(10,'output4')],[[1,3,1],[2,3,2],[1,4,1],[2,4,2],[1,5,1],[2,5,2],[5,6],[3,7],[4,8],[5,9],[6,10]])],
 ['F03 TON/TOF/TP con Q directa y negada',program([...I,N(3,'ton',{time:300}),N(4,'tof',{time:400}),N(5,'tp',{time:200}),N(6,'not'),N(7,'output1'),N(8,'output2'),N(9,'output3'),N(10,'output4')],[[1,3],[1,4],[2,5],[3,7],[4,8],[5,9],[3,6],[6,10]])],
 ['F04 CTU con reset, CTD con carga',program([...I,N(3,'r_trig'),N(4,'ctu',{value:4}),N(5,'ctd',{value:3}),N(6,'output1'),N(7,'output2'),N(8,'not'),N(9,'output3')],[[1,3],[3,4,1],[2,4,2],[3,5,1],[2,5,2],[4,6],[5,7],[5,8],[8,9]])],
 ['F05 SR (set domina)',program([...I,N(3,'sr'),N(4,'output1')],[[1,3,1],[2,3,2],[3,4]])],
 ['F06 RS (reset domina)',program([...I,N(3,'rs'),N(4,'output1')],[[1,3,1],[2,3,2],[3,4]])],
 ['F07 SR y RS con Q compartida y negada',program([...I,N(3,'sr'),N(4,'rs'),N(5,'not'),N(6,'output1'),N(7,'output2'),N(8,'output3')],[[1,3,1],[2,3,2],[2,4,1],[1,4,2],[3,6],[4,7],[3,5],[5,8]])],
 ['F08 flancos positivo y negativo',program([...I,N(3,'r_trig'),N(4,'f_trig'),N(5,'output1'),N(6,'output2'),N(7,'r_trig'),N(8,'output3')],[[1,3],[1,4],[3,5],[4,6],[2,7],[7,8]])],
 ['F09 flanco compartido por dos consumidores',program([...I,N(3,'r_trig'),N(4,'ctu',{value:2}),N(5,'sr'),N(6,'output1'),N(7,'output2')],[[1,3],[3,4,1],[2,4,2],[3,5,1],[2,5,2],[4,6],[5,7]])],
 ['F10 BLINK',program([...I,N(3,'blink',{time:200}),N(4,'output1'),N(5,'and'),N(6,'output2')],[[1,3],[3,4],[3,5,1],[2,5,2],[5,6]])],
 ['F11 CMP con todos los operadores',program([N(1,'analog1'),N(2,'cmp',{op:'>',value:1000}),N(3,'cmp',{op:'<',value:3000}),N(4,'cmp',{op:'>=',value:2048}),N(5,'cmp',{op:'<=',value:2048}),N(6,'cmp',{op:'==',value:2048}),N(7,'cmp',{op:'!=',value:0}),
   N(8,'and'),N(9,'output1'),N(10,'output2'),N(11,'output3'),N(12,'output4')],[[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],[2,8,1],[3,8,2],[8,9],[4,10],[6,11],[7,12]])],
 ['F12 AI1 → SCALE → PWM',program([N(1,'analog1'),N(2,'scale',{inMin:0,inMax:4095,outMin:0,outMax:4095}),N(3,'pwm',{out:0}),N(4,'scale',{inMin:4095,inMax:0,outMin:100,outMax:3000}),N(5,'pwm',{out:1})],[[1,2],[2,3],[1,4],[4,5]])],
 ['F13 SCALE → CMP → salida y PWM a la vez',program([...I,N(3,'analog1'),N(4,'scale',{inMin:0,inMax:4095,outMin:0,outMax:100}),N(5,'cmp',{op:'>=',value:50}),N(6,'and'),N(7,'output1'),N(8,'pwm',{out:2})],[[3,4],[4,5],[5,6,1],[1,6,2],[6,7],[4,8]])],
 ['F14 Q de TON compartida: AND, NOT, OR y a un CTU',program([...I,N(3,'ton',{time:250}),N(4,'and'),N(5,'not'),N(6,'or'),N(7,'ctu',{value:3}),N(8,'r_trig'),N(9,'output1'),N(10,'output2'),N(11,'output3'),N(12,'output4')],[[1,3],[3,4,1],[2,4,2],[3,5],[3,6,1],[2,6,2],[3,8],[8,7,1],[2,7,2],[4,9],[5,10],[6,11],[7,12]])],
 ['F15 combinación: TON → CTU → SR → TOF',program([...I,N(3,'ton',{time:100}),N(4,'r_trig'),N(5,'ctu',{value:3}),N(6,'sr'),N(7,'tof',{time:300}),N(8,'output1'),N(9,'output2'),N(10,'not'),N(11,'output3')],[[1,3],[3,4],[4,5,1],[2,5,2],[5,6,1],[2,6,2],[6,7],[6,8],[7,9],[7,10],[10,11]])],
 ['F16 combinación: BLINK → TP → CTD con carga → CMP',program([...I,N(3,'blink',{time:150}),N(4,'tp',{time:120}),N(5,'r_trig'),N(6,'ctd',{value:5}),N(7,'output1'),N(8,'output2')],[[1,3],[3,4],[4,5],[5,6,1],[2,6,2],[6,7],[4,8]])],
 ['F17 TON, TOF y TP en cascada (límites exactos)',program([...I,N(3,'ton',{time:100}),N(4,'tof',{time:100}),N(5,'tp',{time:100}),N(6,'output1'),N(7,'output2'),N(8,'output3')],[[1,3],[3,4],[4,5],[3,6],[4,7],[5,8]])],
];
FEAT.forEach(([n,p])=>exercise(n,p,{mustConvert:true}));

// ───────── controles negativos: alterar a propósito la conversión y comprobar que las pruebas lo detectan ─────────
const setPreset=d=>rungs=>{rungs.forEach(r=>(r.paths||[]).forEach(p=>p.forEach(e=>{if(e.type==='BLOCK'&&/^T/.test(e.id)&&e.blockType!=='BLINK')e.preset+=d;})));};
exercise('CN1 TON +10 ms',FEAT[2][1],{expectDiff:true,mutate:setPreset(10)});
exercise('CN2 CTU preset +1',FEAT[3][1],{expectDiff:true,mutate:rungs=>rungs.forEach(r=>(r.paths||[]).forEach(p=>p.forEach(e=>{if(e.type==='BLOCK'&&e.blockType==='CTU')e.preset+=1;})))});
exercise('CN3 SR→prioridad RS',FEAT[4][1],{expectDiff:true,mutate:rungs=>rungs.forEach(r=>(r.outputs||[]).forEach(c=>{if(c.mode==='SET'||c.mode==='RESET')c.dom='R';}))});
exercise('CN4 CMP operador alterado',FEAT[10][1],{expectDiff:true,mutate:rungs=>rungs.forEach(r=>(r.paths||[]).forEach(p=>p.forEach(e=>{if(e.type==='CMP'&&e.op==='>')e.op='>=';})))});
exercise('CN5 flanco P→N',FEAT[7][1],{expectDiff:true,mutate:rungs=>rungs.forEach(r=>(r.paths||[]).forEach(p=>p.forEach(e=>{if(e.type==='EDGE'&&e.edge==='P')e.edge='N';})))});
// ───────── (c) programas aleatorios acíclicos ─────────
function randomProgram(seed){
  const rnd=lcg(seed*2654435761>>>0); const pick=a=>a[(rnd()*a.length)|0];
  const nodes=[N(1,'input1'),N(2,'input2')],links=[];let id=3; const bools=[1,2]; const nums=[];
  const add=(name,data)=>{const n=N(id++,name,data);nodes.push(n);return n.id;};
  if(rnd()<0.5){ const a=add('analog1'); nums.push(a); if(rnd()<0.7){ const s=add('scale',{inMin:pick([0,100,4095]),inMax:pick([4095,3000,0]),outMin:pick([0,10]),outMax:pick([100,4095,255])}); links.push([a,s]); nums.push(s);} }
  const count=4+((rnd()*6)|0);
  for(let k=0;k<count;k++){
    const t=pick(['and','or','xor','not','ton','tof','tp','blink','ctu','ctd','sr','rs','r_trig','f_trig','cmp']);
    if(t==='cmp'){ if(!nums.length)continue; const n=add('cmp',{op:pick(['>','<','>=','<=','==','!=']),value:pick([0,1,50,100,500,2048])}); links.push([pick(nums),n]); bools.push(n); continue; }
    if(['and','or','xor','sr','rs','ctu','ctd'].includes(t)){ const d=t==='ctu'||t==='ctd'?{value:pick([2,3,5])}:{}; const n=add(t,d); links.push([pick(bools),n,1],[pick(bools),n,2]); bools.push(n); }
    else { const d=['ton','tof','tp'].includes(t)?{time:pick([50,100,200,500])}:t==='blink'?{time:pick([100,200])}:{}; const n=add(t,d); links.push([pick(bools),n]); bools.push(n); }
  }
  const outs=['output1','output2','output3','output4'].slice(0,1+((rnd()*4)|0)); const used=new Set();
  outs.forEach(o=>{ const n=add(o); const src=pick(bools.slice(2).length?bools.slice(2):bools); links.push([src,n]); });
  if(nums.length&&rnd()<0.5){ const p=add('pwm',{out:3}); links.push([pick(nums),p]); }
  return program(nodes,links);
}
const NR=+(process.env.E4_RANDOM||60);
for(let s=1;s<=NR;s++) exercise('R'+String(s).padStart(2,'0')+' aleatorio acíclico',randomProgram(s),{len:100,seed:s});

// ───────── resumen ─────────
const cnts={};REPORT.forEach(r=>cnts[r.status]=(cnts[r.status]||0)+1);
console.log('\nRESUMEN',JSON.stringify(cnts));
REPORT.filter(r=>r.status==='RECHAZADO').forEach(r=>console.log('  RECHAZADO',r.name,'→',r.detail.slice(0,140)));
REPORT.filter(r=>r.status==='DIFERENCIA'||r.status==='ERROR').forEach(r=>console.log('  !!',r.name,'→',r.detail.slice(0,300)));
fs.writeFileSync(path.join(__dirname,'resultados_e4_conv.json'),JSON.stringify(REPORT,null,1));
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
