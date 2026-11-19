'use strict';
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const R=require('path').resolve(__dirname,'..');
global.window=global;global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const tpl=JSON.parse(fs.readFileSync('/tmp/tpl.json'));
// Construye un Drawflow.export() fiel: inputs/outputs con puertos y conexiones en ambos sentidos
function drawflow(nodes,links){
  const data={};
  nodes.forEach((n,i)=>{const t=tpl[n.name];const ins={},outs={};
    for(let p=1;p<=t.ins;p++)ins['input_'+p]={connections:[]};
    for(let p=1;p<=t.outs;p++)outs['output_'+p]={connections:[]};
    let d=JSON.parse(JSON.stringify(t.data||{}));Object.assign(d,n.data||{});
    data[n.id]={id:n.id,name:n.name,data:d,class:t.cls,html:t.html,typenode:false,inputs:ins,outputs:outs,pos_x:100+(i%6)*170,pos_y:60+Math.floor(i/6)*120};});
  links.forEach(([a,b,port])=>{port=port||1;data[a].outputs.output_1.connections.push({node:String(b),output:'input_'+port});data[b].inputs['input_'+port].connections.push({node:String(a),input:'output_1'});});
  return {drawflow:{Home:{data}}};
}
function envelopeFBD(nodes,links){const fbd=drawflow(nodes,links);const ir=C.compileFBD(fbd);return {format:'plc_program',version:2,fbd:fbd,ir:ir,drawflow:fbd.drawflow,symbolTable:ir.meta.symbolTable};}
const progs={};
// Ej. tipo 6.2: AI1->SCALE->CMP x2 -> SR -> OUT1
progs.p06_termostato=[[{id:1,name:'analog1'},{id:2,name:'scale',data:{inMin:'0',inMax:'4095',outMin:'0',outMax:'50'}},{id:3,name:'cmp',data:{op:'<',value:'18'}},{id:4,name:'cmp',data:{op:'>',value:'25'}},{id:5,name:'sr'},{id:6,name:'output1'}],[[1,2],[2,3],[2,4],[3,5,1],[4,5,2],[5,6]]];
// semáforo con 3 blink/ton y 3 salidas (~12 nodos)
function chain(n,kind){const ns=[{id:1,name:'input1'}],ls=[];for(let i=2;i<=n;i++){ns.push({id:i,name:kind[i%kind.length],data:{time:'1000',value:'3'}});ls.push([i-1,i]);}ns.push({id:n+1,name:'output1'});ls.push([n,n+1]);return [ns,ls];}
progs.p12_cadena=chain(12,['ton','and','not','or']);
progs.p20_cadena=chain(20,['ton','and','not','or','tof']);
progs.p30_cadena=chain(30,['ton','and','not','or','tof','sr']);
progs.p45_cadena=chain(45,['ton','and','not','or','tof','sr','ctu']);
progs.p63_cadena=chain(63,['ton','and','not','or','tof','sr','ctu']);
fs.mkdirSync('/tmp/sz',{recursive:true});
console.log('programa           nodos  JSON(B)  drawflow-solo(B)  ArduinoJson(host64): completo / filtrado   | proyección ESP32 (slots*16+cadenas)');
for(const [name,[ns,ls]] of Object.entries(progs)){
  const env=envelopeFBD(ns,ls);const txt=JSON.stringify(env);fs.writeFileSync(`/tmp/sz/${name}.json`,txt);
  const out=execFileSync(path.join(__dirname,'size/measure'),[`/tmp/sz/${name}.json`]).toString().trim();
  // proyección 32-bit: se cuentan slots y cadenas de cada documento
  function est(doc){let slots=0;const strs=new Set();(function w(v){if(v&&typeof v==='object'){if(Array.isArray(v))v.forEach(x=>{slots++;w(x);});else Object.keys(v).forEach(k=>{slots++;strs.add(k);w(v[k]);});}else if(typeof v==='string')strs.add(v);})(doc);let sb=0;strs.forEach(s=>sb+=Buffer.byteLength(s)+1);return {slots,sb,e32:slots*16+sb,e64:slots*24+sb};}
  const full=est(env);
  const flt=est((function(){const o={drawflow:{Home:{data:{}}}};for(const [k,n] of Object.entries(env.drawflow.Home.data)){o.drawflow.Home.data[k]={id:n.id,name:n.name,data:n.data,outputs:Object.fromEntries(Object.entries(n.outputs).map(([p,v])=>[p,{connections:v.connections}]))};}return o;})());
  console.log(`${name.padEnd(18)} ${String(ns.length).padStart(4)} ${String(txt.length).padStart(8)}  ${String(JSON.stringify({drawflow:env.drawflow}).length).padStart(9)}   ${out.padEnd(40)} | completo ${full.e32} B, filtrado ${flt.e32} B  (modelo 64b completo=${full.e64})`);
}
