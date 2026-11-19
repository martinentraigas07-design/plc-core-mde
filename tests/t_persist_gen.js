'use strict';
// Genera envelopes realistas (mismos html/inputs/outputs que produce Drawflow con editor.js) y mide tamaños.
const fs=require('fs'),vm=require('vm'),path=require('path');
const R=require('path').resolve(__dirname,'..');
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const src=fs.readFileSync(path.join(R,'editor.js'),'utf8');
const added=[];
const ctx={console,editor:{addNode:(name,ins,outs,x,y,cls,data,html)=>added.push({name,ins,outs,x,y,cls,data,html})},document:{getElementById:()=>({}),addEventListener(){}},window:{},Drawflow:function(){return {start(){},on(){}}},setInterval(){},fetch(){}};
vm.createContext(ctx);
try{vm.runInContext(src+'\n;this.__fn=Object.keys(this).filter(k=>/^add[A-Z]/.test(k));',ctx);}catch(e){console.error('editor.js eval:',e.message);}
const fns=(ctx.__fn||[]);console.error('funciones add*:',fns.join(' '));
const tpl={};
fns.forEach(fn=>{added.length=0;try{ctx[fn]();}catch(e){return;} if(added[0])tpl[added[0].name]=added[0];});
fs.writeFileSync('/tmp/tpl.json',JSON.stringify(tpl));
console.error('plantillas:',Object.keys(tpl).join(' '));
