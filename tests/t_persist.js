'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const H=require('./harness');const {program,runSim,check}=H;
const R=require('path').resolve(__dirname,'..');
global.window=global;global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const BIN=n=>path.join(__dirname,'hostfw',n);
function fw(bin,file,steps){const r=spawnSync(BIN(bin),[file],{input:steps.map(s=>s.join(' ')).join('\n')+'\n',encoding:'utf8'});
  return {out:r.stdout.trim().split('\n').filter(Boolean),log:r.stderr,status:r.status};}
const used=log=>{const m=/JSON OK: (\d+) bytes de documento usados \(cap=(\d+)\)/.exec(log);return m?{used:+m[1],cap:+m[2]}:null;};
// ---- P1: envelopes reales de 6 a 64 nodos (con html, ir y duplicados como los guarda program.html)
const sizes={p06_termostato:6,p12_cadena:13,p20_cadena:21,p30_cadena:31,p45_cadena:46,p63_cadena:64};
for(const [n,cnt] of Object.entries(sizes)){
  const f=`/tmp/sz/${n}.json`;const r=fw('fwhost',f,[['count']]);const u=used(r.log);
  const nodes=/COUNT (\d+) (\d+)/.exec(r.out[0]||'');
  check(`P1 ${n} (${cnt} nodos, ${fs.statSync(f).size} B de JSON): carga completa y orden calculado`,nodes&&+nodes[1]===cnt&&+nodes[2]===cnt,
    u?`doc usado (host 64-bit) ${u.used} B, capacidad elegida ${u.cap}`:r.log.trim().split('\n').slice(-2).join(' / '));
}
// ---- P2: el programa del termostato se ejecuta igual con el envelope completo que con drawflow solo (FW y SIM)
{
  const env=JSON.parse(fs.readFileSync('/tmp/sz/p06_termostato.json'));
  const only={drawflow:env.drawflow};fs.writeFileSync('/tmp/sz/p06_only.json',JSON.stringify(only));
  const st=[['ai',0,100],['scan',3],['print'],['ai',0,3000],['scan',3],['print'],['ai',0,1900],['scan',3],['print'],['ai',0,100],['scan',3],['print']];
  const a=fw('fwhost','/tmp/sz/p06_termostato.json',st).out,b=fw('fwhost','/tmp/sz/p06_only.json',st).out,s=runSim(env,st);
  check('P2 termostato: envelope completo == solo drawflow == simulador',a.join()===b.join()&&a.join()===s.join(),a.map(l=>l.slice(4,11)).join(' | '));
}
// ---- P3: compatibilidad con formatos guardados por versiones anteriores
{
  // (a) UI antigua (firmware/data): solo editor.export() == {drawflow:{Home:{data}}}
  const p=program([{id:1,name:'input1'},{id:2,name:'not'},{id:3,name:'output1'}],[[1,2],[2,3]]);
  fs.writeFileSync('/tmp/sz/legacy_export.json',JSON.stringify(p));
  const st=[['in',0,0],['scan',2],['print'],['in',0,1],['scan',2],['print']];
  const a=fw('fwhost','/tmp/sz/legacy_export.json',st).out;
  check('P3a programa guardado por la UI antigua (solo editor.export()) sigue cargando',a[0].startsWith('OUT 1')&&a[1].startsWith('OUT 0'),a.join(' | '));
  // (b) envelope Ladder (version 3, sin html)
  const K=v=>({type:'CONTACT',var:v,negated:false});
  const ir=C.compileLadder({rungs:[{id:'r1',paths:[[K('X0')],[K('Y0')]].map(x=>x.concat([{type:'CONTACT',var:'X1',negated:true}])),outputs:[{type:'COIL',var:'Y0',mode:'NORMAL'}]}]});
  const env={format:'plc_program',version:3,source:'ladder',ladder:{rungs:[]},ir:ir,order:ir.order,drawflow:C.irToDrawflow(ir.program.nodes).drawflow,symbolTable:ir.meta.symbolTable};
  fs.writeFileSync('/tmp/sz/ladder_env.json',JSON.stringify(env));
  const st2=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print']];
  const b=fw('fwhost','/tmp/sz/ladder_env.json',st2).out;
  check('P3b envelope Ladder v3 carga y el enclavamiento funciona (1,1,0)',b[0].startsWith('OUT 1')&&b[1].startsWith('OUT 1')&&b[2].startsWith('OUT 0'),b.join(' | '));
  // (c) dato numérico (no string) en data y strings numéricos: ambos
  const q=program([{id:1,name:'input1'},{id:2,name:'ton',data:{time:150}},{id:3,name:'output1'}],[[1,2],[2,3]]);
  fs.writeFileSync('/tmp/sz/num.json',JSON.stringify(q));
  const c=fw('fwhost','/tmp/sz/num.json',[['in',0,1],['scan',5],['print'],['adv',200],['scan',2],['print']]).out;
  check('P3c time numérico (no string) se interpreta',c[0].startsWith('OUT 0')&&c[1].startsWith('OUT 1'),c.join(' | '));
}
// ---- P4: carga transaccional
{
  fs.writeFileSync('/tmp/sz/garbage.json','{"drawflow":{"Home":{"data":{"1":{"id":1,"name":"inp');   // truncado a mitad
  fs.writeFileSync('/tmp/sz/nodata.json','{"format":"plc_program","version":2}');
  fs.writeFileSync('/tmp/sz/empty.json','');
  const p=program([{id:1,name:'input1'},{id:2,name:'output1'}],[[1,2]]);fs.writeFileSync('/tmp/sz/ok.json',JSON.stringify(p));
  const st=[['count'],['reload','/tmp/sz/garbage.json'],['count'],['reload','/tmp/sz/nodata.json'],['count'],['in',0,1],['scan',2],['print'],['reload','/tmp/sz/empty.json'],['count']];
  const r=fw('fwhost','/tmp/sz/ok.json',st).out;
  check('P4 JSON truncado / sin drawflow NO borra el programa en ejecución; JSON vacío sí lo borra',
    r[0]==='COUNT 2 2'&&r[1]==='COUNT 2 2'&&r[2]==='COUNT 2 2'&&r[3].startsWith('OUT 1')&&r[4]==='COUNT 0 0',r.join(' | '));
}
// ---- P5: capacidades adaptativas (builds con capacidades chicas: 2048/6000/9000)
{
  const a=fw('fwhost_smallcap','/tmp/sz/p06_termostato.json',[['count']]);const ua=used(a.log);
  check('P5a termostato con cap1 insuficiente escala a la siguiente capacidad',ua&&ua.cap===6000&&/COUNT 6 6/.test(a.out[0]),JSON.stringify(ua));
  const big=fw('fwhost_smallcap','/tmp/sz/p63_cadena.json',[['count']]);
  check('P5b programa que no entra en ninguna capacidad: error explícito y 0 nodos (no hay programa previo)',/COUNT 0 0/.test(big.out[0])&&/NoMemory|JSON error/.test(big.log),big.log.trim().split('\n').slice(-1)[0]);
  const r=fw('fwhost_smallcap','/tmp/sz/p06_termostato.json',[['count'],['reload','/tmp/sz/p63_cadena.json'],['count']]).out;
  check('P5c un programa demasiado grande NO desplaza al programa que ya corría',r[0]==='COUNT 6 6'&&r[1]==='COUNT 6 6',r.join(' | '));
}
// ---- P6: sin filtro (comportamiento anterior) el mismo envelope necesitaba mucho más
{
  const out=require('child_process').execFileSync(path.join(__dirname,'size/measure'),['/tmp/sz/p06_termostato.json']).toString().trim();
  check('P6 referencia de medición (host 64-bit): completo vs filtrado del termostato',true,out);
}
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
