'use strict';
// E4.4 — Ruta de compilación única (compileLadder). Se verifica contra un intérprete de referencia independiente
// (semántica combinacional por dependencias, SR con prioridad SET salvo dom:'R') y se documenta por qué se descartó la ruta AST.
const path=require('path'),fs=require('fs');
const R=process.env.REPO||path.resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const H=require('./harness'); const {check}=H;
const _warn=console.warn,_info=console.info; console.warn=()=>{};console.info=()=>{};
const html=fs.readFileSync(path.join(R,'ladder.html'),'utf8');
// ruta AST antigua: se extrae la función que existe en ladder.html (ya no se usa al compilar) sólo para compararla
const a=html.indexOf('function _rungs_to_ladder_ast');let d=0,i=html.indexOf('{',a),j=i;for(;j<html.length;j++){if(html[j]=='{')d++;if(html[j]=='}'){d--;if(!d)break;}}
const toAST=new Function('LadderProgram',html.slice(a,j+1)+';return _rungs_to_ladder_ast;')(LadderProgram);
check('RUTA.0 compileAndSend ya no invoca compileLadderAST', !/PlcCompiler\.compileLadderAST\(/.test(html));
const lcg=s=>()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
const K=(v,n)=>({type:'CONTACT',var:v,negated:!!n});
// intérprete de referencia: devuelve función scan(x0,x1)→[Y0..Y3] o null si hay dependencia cíclica
function reference(rungs){
  const w={};  // var → {normal:[cond], set:[cond], reset:[cond], dom}
  rungs.forEach(r=>r.outputs.forEach(c=>{const e=w[c.var]=w[c.var]||{normal:[],set:[],reset:[],dom:false};
    ({NORMAL:e.normal,SET:e.set,RESET:e.reset})[c.mode].push(r); if(c.dom==='R')e.dom=true;}));
  for(const v in w){ const e=w[v]; if(e.normal.length>1||(e.normal.length&&(e.set.length||e.reset.length))) return null; }
  const deps=v=>{const s=new Set();const e=w[v];if(!e)return s;[...e.normal,...e.set,...e.reset].forEach(r=>r.paths.forEach(p=>p.forEach(x=>s.add(x.var))));return s;};
  const state={};
  return function(x){
    const memo={},stack=new Set();
    const val=v=>{
      if(v==='X0')return x[0]; if(v==='X1')return x[1];
      if(!w[v])return 0; if(v in memo)return memo[v];
      if(stack.has(v))throw new Error('cycle'); stack.add(v);
      const cond=r=>r.paths.some(p=>p.every(e=>{const b=val(e.var);return e.negated?!b:!!b;}));
      const e=w[v]; let out;
      if(e.normal.length) out=e.normal[0]&&cond(e.normal[0])?1:0;
      else { const s=e.set.some(cond),rs=e.reset.some(cond); let st=state[v]||0;
        if(e.dom){ st = rs?0:(s?1:st); } else { st = s?1:(rs?0:st); }
        state[v]=st; out=st; }
      stack.delete(v); memo[v]=out; return out; };
    return ['Y0','Y1','Y2','Y3'].map(v=>val(v));
  };
}
function cyclic(rungs){ // dependencia de una variable de sí misma, directa o indirecta (mediante contactos sobre variables escritas)
  const w={};rungs.forEach(r=>r.outputs.forEach(c=>{(w[c.var]=w[c.var]||new Set());r.paths.forEach(p=>p.forEach(e=>w[c.var].add(e.var)));}));
  const seen=(v,t,vis)=>{ if(vis.has(v))return false; vis.add(v); for(const u of (w[v]||[])){ if(u===t)return true; if(seen(u,t,vis))return true;} return false; };
  return Object.keys(w).some(v=>seen(v,v,new Set()));
}
let n=0,compared=0,skipped=0,mism=0,astDiff=0,astFail=0,astCmp=0;
for(let seed=1;seed<=2000;seed++){
  const r=lcg(seed*7919),pick=a=>a[(r()*a.length)|0];
  const rungs=[];const k=2+((r()*4)|0);const used=new Set();
  for(let q=0;q<k;q++){
    const np=1+((r()*3)|0),paths=[];for(let p=0;p<np;p++){const L=1+((r()*3)|0),pa=[];for(let e=0;e<L;e++)pa.push(K(pick(['X0','X1','X0','X1','M0','M1','Y0','Y1']),r()<0.3));paths.push(pa);}
    const tgt=pick(['Y0','Y1','Y2','M0','M1']);
    const kind=pick(['N','N','SR','RS']);
    if(kind==='N'){ if(used.has(tgt+'N')||used.has(tgt+'L'))continue; used.add(tgt+'N'); rungs.push({id:'r'+q,comment:'',paths,outputs:[{type:'COIL',var:tgt,mode:'NORMAL'}]}); }
    else { if(used.has(tgt+'N'))continue; used.add(tgt+'L');
      const dom=kind==='RS'||(used.has(tgt+'dom'));
      const mk=(mode)=>{const c={type:'COIL',var:tgt,mode}; if(kind==='RS')c.dom='R'; return c;};
      rungs.push({id:'r'+q+'s',comment:'',paths,outputs:[mk('SET')]});
      const p2=[[K(pick(['X0','X1','M0','M1']),r()<0.5)]];
      rungs.push({id:'r'+q+'r',comment:'',paths:p2,outputs:[mk('RESET')]}); used.add(tgt+'dom'); }
  }
  if(!rungs.length)continue; n++;
  if(cyclic(rungs)){skipped++;continue;}
  const ref=reference(rungs); if(!ref){skipped++;continue;}
  let ir;try{ir=C.compileLadder({rungs});}catch(e){skipped++;continue;}
  const prog={drawflow:C.irToDrawflow(ir.program.nodes).drawflow};
  const rn=lcg(seed),x=[0,0],st=[],exp=[];
  for(let t=0;t<60;t++){ if(rn()<.5)x[0]=rn()<.5?1:0; if(rn()<.5)x[1]=rn()<.5?1:0;
    st.push(['in',0,x[0]],['in',1,x[1]],['scan',1],['print']); exp.push(ref(x).join('')); }
  const fw=H.runFirmware(prog,st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join(''));
  const sm=H.runSim(prog,st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join(''));
  compared++;
  const ok=JSON.stringify(fw)===JSON.stringify(exp)&&JSON.stringify(sm)===JSON.stringify(exp);
  if(!ok){mism++; if(mism<=3)console.log('  difiere',JSON.stringify(rungs.map(r=>({p:r.paths.map(p=>p.map(e=>(e.negated?'/':'')+e.var).join('.')).join('+'),o:r.outputs.map(c=>c.mode+(c.dom||'')+' '+c.var).join()}))),'esp',exp.slice(0,6).join(),'fw',fw.slice(0,6).join());}
  // comparación informativa con la ruta AST antigua
  let irA=null;try{irA=C.compileLadderAST(toAST(JSON.parse(JSON.stringify(rungs))));}catch(e){astFail++;}
  if(irA){astCmp++;const fa=H.runFirmware({drawflow:C.irToDrawflow(irA.program.nodes).drawflow},st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join(''));
    if(JSON.stringify(fa)!==JSON.stringify(exp))astDiff++;}
}
console.warn=_warn;console.info=_info;
console.log(`# programas generados=${n}, sin realimentación y comparables=${compared}, omitidos=${skipped}`);
console.log(`# ruta AST antigua: no compila (cae a paths)=${astFail}/${compared}; compila pero difiere de la referencia=${astDiff}/${astCmp}`);
check('RUTA.1 compileLadder == intérprete de referencia (FW y SIM) en '+compared+' programas contacto/SET/RESET/SR/RS',mism===0&&compared>150,`${mism} diferencias`);
check('RUTA.2 la ruta AST antigua NO es equivalente (justifica descartarla)',astDiff+astFail>0,`${astFail} fallos + ${astDiff} diferencias`);
// regresión puntual documentada
{ const rungs=[{id:'a',comment:'',paths:[[K('M1',1)],[K('X0')],[K('X1')]],outputs:[{type:'COIL',var:'M1',mode:'SET'}]},{id:'b',comment:'',paths:[[K('M1',1)],[K('X1',1),K('X1')]],outputs:[{type:'COIL',var:'Y1',mode:'NORMAL'}]}];
  console.warn=()=>{};
  const st=[['scan',1],['print'],['in',0,1],['scan',1],['print']];
  const o=ir=>H.runFirmware({drawflow:C.irToDrawflow(ir.program.nodes).drawflow},st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
  const pa=o(C.compileLadder({rungs})); let aa; try{aa=o(C.compileLadderAST(toAST(JSON.parse(JSON.stringify(rungs)))));}catch(e){aa='error';}
  console.warn=_warn;
  check('RUTA.3 caso límite: SET M1 con /M1 y Y1=/M1: paths da 0000 (M1 se activa antes de leerse), AST da otra cosa',pa==='0000,0000'&&aa!==pa,`paths=${pa} ast=${aa}`); }
// regresión del defecto corregido en E4: SET c / RESET /c generaba SR(S=X,R=NOT X) que el motor lee como registro de 1 scan
{ const rungs=[{id:'a',comment:'',paths:[[K('X0')]],outputs:[{type:'COIL',var:'Y0',mode:'SET'}]},{id:'b',comment:'',paths:[[K('X0',1)]],outputs:[{type:'COIL',var:'Y0',mode:'RESET'}]}];
  console.warn=()=>{}; const ir=C.compileLadder({rungs}); console.warn=_warn;
  const p={drawflow:C.irToDrawflow(ir.program.nodes).drawflow};
  const st=[['scan',1],['print'],['in',0,1],['scan',1],['print'],['in',0,0],['scan',1],['print']];
  const f=H.runFirmware(p,st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(','), m=H.runSim(p,st).filter(l=>l.startsWith('OUT')).map(l=>l.split(' ').slice(1,5).join('')).join(',');
  check('RUTA.4 SET X0 / RESET /X0 sobre Y0 sigue a X0 sin retardo de un scan (FW y SIM)',f==='0000,1000,0000'&&m===f,`FW ${f} SIM ${m} latch=${ir.program.nodes.filter(n=>/^(sr|rs)$/.test(n.type)).map(n=>n.type).join()}`); }
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
