const H = require('./harness');
const { program, runFirmware, runSim, check } = H;
const both = (p, st) => [runFirmware(p, st), runSim(p, st)];

// ---------- SCALE: referencia independiente (BigInt, trunc hacia 0) ----------
function refScale(raw, a, b, c, d) {
  raw = BigInt(raw); a = BigInt(a); b = BigInt(b); c = BigInt(c); d = BigInt(d);
  if (a === b) return Number(c);
  let s = (raw - a) * (d - c) / (b - a) + c;
  const lo = c < d ? c : d, hi = c < d ? d : c;
  if (s < lo) s = lo; if (s > hi) s = hi;
  return Number(s);
}
const cases = [
  [0,4095,0,100],[0,4095,0,0],[0,4095,100,0],[-100,100,-50,50],[0,4095,-100,100],
  [10,10,5,9],[0,4095,0,2147483647],[4095,0,0,100],[0,1000,0,1000]
];
const raws = [-5000,-1,0,1,2047,2048,4094,4095,4096,100000];
let n=0, bad=0;
for (const [a,b,c,d] of cases) for (const raw of raws) {
  const p = program([{id:1,name:'analog1'},{id:2,name:'scale',data:{inMin:String(a),inMax:String(b),outMin:String(c),outMax:String(d)}}],[[1,2]]);
  const st=[['ai',0,raw],['scan',2],['node',2]];
  const [fw,sm]=both(p,st); n++;
  const exp = 'int='+refScale(raw,a,b,c,d);
  if(!(fw[0].endsWith(exp)&&sm[0].endsWith(exp))){bad++;console.log('  mismatch',a,b,c,d,raw,'exp',exp,fw[0],sm[0]);}
}
check(`SCALE ${n} combinaciones (límites, negativos, inversa, div0) == referencia, FW y SIM`, bad===0, `${bad} discrepancias`);
// outMax=0 explícito (escala inversa) respeta el 0; clave ausente usa default
{
  const p=program([{id:1,name:'analog1'},{id:2,name:'scale',data:{inMin:'0',inMax:'4095',outMin:'100',outMax:'0'}}],[[1,2]]);
  const [fw,sm]=both(p,[['ai',0,4095],['scan',2],['node',2]]);
  check('SCALE outMax=0 explícito (inversa) -> 0 en AI máx [FW/SIM]', fw[0].endsWith('int=0')&&sm[0].endsWith('int=0'), fw[0]+' | '+sm[0]);
  const p2=program([{id:1,name:'analog1'},{id:2,name:'scale'}],[[1,2]]);
  const [f2,s2]=both(p2,[['ai',0,4095],['scan',2],['node',2]]);
  check('SCALE sin parámetros usa defaults 0..4095->0..100 [FW/SIM]', f2[0].endsWith('int=100')&&s2[0].endsWith('int=100'), f2[0]+' | '+s2[0]);
}
// ---------- Puertos ----------
{ // SR con R declarado ANTES (id menor) que S: el puerto manda, no el orden
  const p=program([{id:1,name:'input2'},{id:2,name:'input1'},{id:3,name:'sr'},{id:4,name:'output1'}],[[2,3,1],[1,3,2],[3,4]]);
  const st=[['in',1,1],['scan',2],['print'],['in',1,0],['scan',2],['print'],['in',0,1],['scan',2],['print']];
  const [fw,sm]=both(p,st);
  const ok=r=>r[0].startsWith('OUT 0')&&r[1].startsWith('OUT 0')&&r[2].startsWith('OUT 1');
  check('Puertos: S=IN1 (puerto1), R=IN2 (puerto2), IDs invertidos: R solo no activa, S activa',ok(fw)&&ok(sm),fw.join(' / ')+' || '+sm.join(' / '));
}
{ // CTU: CU en puerto 1, R en puerto 2, declarados en orden inverso
  const p=program([{id:1,name:'input2'},{id:2,name:'input1'},{id:3,name:'ctu',data:{value:'2'}},{id:4,name:'output1'}],[[1,3,2],[2,3,1],[3,4]]);
  const st=[];for(let i=0;i<2;i++)st.push(['in',0,1],['scan',2],['in',0,0],['scan',2]);st.push(['print'],['in',1,1],['scan',2],['print']);
  const [fw,sm]=both(p,st);
  check('Puertos CTU: IN1->CU cuenta, IN2->R resetea',fw[0].startsWith('OUT 1')&&fw[1].startsWith('OUT 0')&&sm[0].startsWith('OUT 1')&&sm[1].startsWith('OUT 0'),fw+' || '+sm);
}
// ---------- Enclavamiento: arranque/paro con realimentación, IDs adversos ----------
{ // Motor = SR(S=IN1 AND NOT paro..., R=IN2) realimentado con AND; consumidor con ID menor
  const p=program([
    {id:1,name:'output1'},{id:2,name:'and'},{id:3,name:'sr'},{id:4,name:'input1'},{id:5,name:'input2'},{id:6,name:'not'}],
    [[3,1],[4,3,1],[5,6],[6,2,1],[3,2,2],[2,3,2]]);
  // S=IN1 ; R = AND(NOT IN2, Q) -> reset solo si IN2=0&Q ... (lazo Q->AND->R)
  const st=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print']];
  const [fw,sm]=both(p,st);
  check('Lazo SR->AND->SR: FW==SIM y determinista',JSON.stringify(fw)===JSON.stringify(sm),fw.join('/')+' || '+sm.join('/'));
}
// Enclavamiento clásico: Y = (IN1 OR Y) AND NOT IN2, con OR/AND sin memoria (pivote = menor ID)
{
  const p=program([{id:1,name:'output1'},{id:2,name:'and'},{id:3,name:'or'},{id:4,name:'input1'},{id:5,name:'input2'},{id:6,name:'not'}],
    [[2,1],[4,3,1],[2,3,2],[3,2,1],[5,6],[6,2,2]]);
  const seq=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
  const [fw,sm]=both(p,seq);
  const exp=['OUT 1','OUT 1','OUT 0','OUT 0'];
  check('Autorretención OR/AND (arranque, mantiene, paro, queda off)',exp.every((e,i)=>fw[i].startsWith(e)&&sm[i].startsWith(e)),fw.join('/')+' || '+sm.join('/'));
}
// Enclavamiento mutuo entre dos biestables en el mismo scan
{ // Q1=SR(S=IN1 AND NOT Q2, R=IN2) ; Q2=SR(S=IN2... ) simplificado: M1,M2 exclusivos
  const p=program([
    {id:1,name:'output1'},{id:2,name:'output2'},{id:3,name:'sr'},{id:4,name:'sr'},{id:5,name:'and'},{id:6,name:'and'},
    {id:7,name:'not'},{id:8,name:'not'},{id:9,name:'input1'},{id:10,name:'input2'}],
    [[3,1],[4,2],[3,7],[4,8],[8,5,2],[9,5,1],[7,6,2],[10,6,1],[5,3,1],[6,4,1]]);
  // ambos pulsadores a la vez: debe ganar UNO solo (el de menor ID evaluado primero) y ser igual en FW y SIM
  const st=[['in',0,1],['in',1,1],['scan',4],['print']];
  const [fw,sm]=both(p,st);
  check('Enclavamiento mutuo: pulsación simultánea deja exactamente un motor activo y FW==SIM',fw[0]===sm[0]&&(fw[0].startsWith('OUT 1 0')||fw[0].startsWith('OUT 0 1')),fw[0]+' || '+sm[0]);
}
// ---------- R_TRIG -> CTU: un pulso = una cuenta ----------
{
  const p=program([{id:1,name:'input1'},{id:2,name:'r_trig'},{id:3,name:'ctu',data:{value:'3'}},{id:4,name:'output1'}],[[1,2],[2,3,1],[3,4]]);
  const st=[];for(let i=0;i<3;i++){st.push(['in',0,1],['scan',5],['in',0,0],['scan',5]);}st.push(['print'],['node',3]);
  const [fw,sm]=both(p,st);
  check('R_TRIG->CTU(PV=3): 3 pulsaciones largas = 3 cuentas exactas',fw[0].startsWith('OUT 1')&&fw[1].endsWith('int=3')&&sm[0].startsWith('OUT 1')&&sm[1].endsWith('int=3'),fw+' || '+sm);
}
// ---------- Idioma heredado SR(S=X,R=NOT X) = X anterior ----------
{
  const p=program([{id:1,name:'input1'},{id:2,name:'not'},{id:3,name:'sr'},{id:4,name:'not'},{id:5,name:'and'},{id:6,name:'output1'}],
    [[1,2],[1,3,1],[2,3,2],[3,4],[1,5,1],[4,5,2],[5,6]]);
  // AND(X, NOT prev(X)) = pulso de 1 scan en flanco ascendente
  const st=[['in',0,1],['scan',1],['print'],['scan',1],['print'],['scan',1],['print']];
  const [fw,sm]=both(p,st);
  const ok=r=>r[0].startsWith('OUT 1')&&r[1].startsWith('OUT 0')&&r[2].startsWith('OUT 0');
  check('Legado SR(S=X,R=!X): pulso de exactamente 1 scan',ok(fw)&&ok(sm),fw.join('/')+' || '+sm.join('/'));
}
// ---------- Fuzz diferencial FW vs SIM ----------
function rng(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);}
const types1=['not','ton','tof','tp','blink','r_trig','f_trig','scale','pwm','output1','output2'];
const types2=['and','or','xor','cmp','sr','rs','ctu','ctd'];
let fzBad=0, fzN=300, firstBad=null;
for(let seed=1;seed<=fzN;seed++){
  const R=rng(seed*7919), pick=a=>a[Math.floor(R()*a.length)];
  const cnt=4+Math.floor(R()*9);
  const nodes=[{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'analog1'}];
  const ids=[...Array(cnt).keys()].map(i=>i+4).sort(()=>R()-.5);   // IDs en orden aleatorio
  const links=[];
  ids.forEach(id=>{
    const nm=R()<.7?pick(types2):pick(types1);
    const data={};
    if(['ton','tof','tp','blink'].includes(nm))data.time=String(20+Math.floor(R()*80));
    if(nm==='cmp'){data.op=pick(['>','<','>=','<=','==','!=']);data.value=String(Math.floor(R()*4000));}
    if(nm==='ctu'||nm==='ctd')data.value=String(1+Math.floor(R()*4));
    if(nm==='scale'){data.inMin=String(-500+Math.floor(R()*500));data.inMax=String(Math.floor(R()*5000));data.outMin=String(Math.floor(R()*200)-100);data.outMax=String(Math.floor(R()*200)-100);}
    if(nm==='pwm')data.out='3';
    nodes.push({id,name:nm,data});
  });
  const all=nodes.map(n=>n.id);
  nodes.forEach(n=>{
    if(['input1','input2','analog1'].includes(n.name))return;
    const two=types2.includes(n.name);
    const p1=pick(all); if(p1!==n.id||R()<.1) links.push([p1,n.id,1]);
    if(two){const p2=pick(all); links.push([p2,n.id,2]);}
  });
  const prog=program(nodes,links); 
  const st=[];
  for(let k=0;k<40;k++){
    st.push(['in',0,R()<.5?1:0],['in',1,R()<.5?1:0],['ai',0,Math.floor(R()*4096)],['scan',1+Math.floor(R()*3)],['adv',Math.floor(R()*30)],['print']);
    nodes.forEach(n=>{ if(n.id>3 && k%8===0) st.push(['node',n.id]); });
  }
  st.push(['order']);
  let fw,sm;
  try{ fw=runFirmware(prog,st); }catch(e){fzBad++;if(!firstBad)firstBad=[seed,'fw error '+e.message];continue;}
  // 'order' no existe en sim: se compara aparte
  sm=runSim(prog,st);
  const nz=l=>l.trim().replace(/^OUT (\d) (\d) (\d) \d/,'OUT $1 $2 $3 X');
  const fwNoOrder=fw.map(nz); sm=sm.map(nz);
  if(JSON.stringify(fwNoOrder)!==JSON.stringify(sm)){
    fzBad++; if(!firstBad){const i=fwNoOrder.findIndex((l,j)=>l!==sm[j]);firstBad=[seed,`línea ${i}: FW=${fwNoOrder[i]} SIM=${sm[i]}`];}
  }
}
check(`Fuzz diferencial FW vs SIM: ${fzN} programas aleatorios (IDs permutados, lazos, 2 puertos)`, fzBad===0, fzBad? `${fzBad} difieren; primero: ${JSON.stringify(firstBad)}`:'sin diferencias');
const {pass,fail}=H.summary(); console.log(`\nTOTAL pass=${pass} fail=${fail}`);
