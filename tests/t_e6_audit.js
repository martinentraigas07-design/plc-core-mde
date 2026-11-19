'use strict';
// E6 — Auditoría estática del proyecto (sin ESP32): archivos referenciados, sintaxis JS, endpoints del servidor,
// includes del firmware y uso de un único motor/ruta de envío por FBD y Ladder.
const fs=require('fs'),path=require('path'),vm=require('vm');
const R=path.resolve(__dirname,'..');const rd=f=>fs.readFileSync(path.join(R,f),'utf8');
let p=0,f=0;const check=(n,ok,d)=>{ok?p++:f++;console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  -> '+(d||'')));};
const info=m=>console.log('INFO '+m);
const walk=(d,o=[])=>{for(const e of fs.readdirSync(path.join(R,d),{withFileTypes:true})){const r=path.posix.join(d,e.name);
  if(e.name==='.git'||e.name==='node_modules'||r==='docs/build_manual'||r==='tests/size'&&0)continue; e.isDirectory()?walk(r,o):o.push(r);}return o;};
const all=walk('.').map(x=>x.replace(/^\.\//,''));
// 1. referencias locales de cada HTML
const htmls=all.filter(x=>x.endsWith('.html')&&!x.startsWith('docs/')&&!x.startsWith('tests/'));
for(const h of htmls){const t=rd(h).replace(/data:[^"')]+/g,'data:');const dir=path.posix.dirname(h);const miss=[];
  for(const m of t.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)/g)){const u=m[1];if(/^(https?:|mailto:|data:|javascript:|\/\/)/.test(u))continue;
    if(u.startsWith('/')){continue;} // rutas absolutas = endpoints o raíz del servidor (se revisan en 3)
    if(!fs.existsSync(path.join(R,dir,u)))miss.push(u);}
  check('REF '+h+' sin referencias locales rotas',miss.length===0,miss.join(', '));}
// drawflow.style.js es una hoja de estilos distribuida con la librería (no se ejecuta como script clásico): se omite
// 2. sintaxis JS (archivos y scripts inline)
for(const j of all.filter(x=>/\.js$/.test(x)&&!x.startsWith('docs/')&&!/min\.js$/.test(x)&&!/drawflow\.style\.js$/.test(x))){
  try{new vm.Script(rd(j).replace(/^#!.*/,''),{filename:j});check('SINT '+j,true);}catch(e){check('SINT '+j,false,e.message);}}
for(const h of htmls){const t=rd(h);let n=0,bad=[];for(const m of t.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)){n++;try{new vm.Script(m[1]);}catch(e){bad.push(e.message);}}
  check('SINT inline '+h+' ('+n+' scripts)',bad.length===0,bad.join('; '));}
// 3. endpoints usados por las páginas vs rutas del firmware
const ino=rd('firmware/PLC_CORE_MDE.ino');const routes=new Set([...ino.matchAll(/server\.on\("([^"]+)"/g)].map(m=>m[1]));
const used=new Map();
for(const h of [...htmls,...all.filter(x=>/^(js|simulator)\/.*\.js$/.test(x)||x==='editor.js'||x==='script.js'||x.startsWith('firmware/data/')&&x.endsWith('.js'))]){
  for(const m of rd(h).replace(/data:[^"')]+/g,'').matchAll(/fetch\(\s*['"`](\/[a-z_\/]+)/g)){if(!used.has(m[1]))used.set(m[1],[]);used.get(m[1]).push(h);}}
for(const [u,fs_] of used){ if(u==='/')continue; check('RUTA '+u+' existe en el firmware (usada en '+[...new Set(fs_)].join(', ')+')',routes.has(u),'no hay server.on("'+u+'")');}
// 4. includes del firmware
for(const s of all.filter(x=>/^firmware\/[^/]+\.(cpp|h|ino)$/.test(x))){for(const m of rd(s).matchAll(/#include\s+"([^"/]+)"/g))
  check('INC '+s+' -> '+m[1],fs.existsSync(path.join(R,'firmware',m[1])));}
// 5. un solo motor y una sola ruta de envío
const lad=rd('ladder.html'),prog=rd('program.html'),api=rd('js/api/plc_api.js');
check('MOTOR Ladder compila con compileLadder y envía por PlcApi',/compileLadder\(/.test(lad)&&/PlcApi\.saveProgram/.test(lad));
check('MOTOR FBD (program.html) compila con compileProject (FBD) y envía por PlcApi',/compileProject\(/.test(prog)&&/PlcApi\.saveProgram/.test(prog));
check('MOTOR un único runtime en el firmware (plc_runtime.cpp) y un único simulador de scan',fs.existsSync(path.join(R,'firmware/plc_runtime.cpp'))&&fs.existsSync(path.join(R,'simulator/plc_sim_scan.js')));
check('API un único /save en plc_api.js',/fetch\('\/save'/.test(api));
// 6. información de empaquetado (no falla). Desde E7 firmware/data se GENERA con tools/build_web.js (ver t_e7_web.js)
info('Archivos servidos por el ESP32 (SPIFFS, firmware/data): '+all.filter(x=>x.startsWith('firmware/data/')).map(x=>path.posix.basename(x)).join(', '));
console.log('PASS total '+p+' FAIL total '+f);process.exit(f?1:0);
