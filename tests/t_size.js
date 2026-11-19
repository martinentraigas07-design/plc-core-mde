'use strict';
const path=require('path');const R=require('path').resolve(__dirname,'..');
const H=require('./harness');const {program,runFirmware}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
// Estimador ArduinoJson v6 (32-bit, ESP32): slot=16 B por valor/miembro, + cadenas copiadas (deduplicadas) con '\0'
function est(doc){let slots=0;const strs=new Set();
  (function w(v){ if(v&&typeof v==='object'){ if(Array.isArray(v)){v.forEach(x=>{slots++;w(x);});} else Object.keys(v).forEach(k=>{slots++;strs.add(k);w(v[k]);}); } else if(typeof v==='string'){strs.add(v);} })(doc);
  let sb=0;strs.forEach(s=>sb+=Buffer.byteLength(s)+1); return {slots,bytes:slots*16+sb,strBytes:sb};}
// Programa tipo Ej. 6.2 (AI1->SCALE->CMP<18/CMP>25->SR->OUT1) + temporizador
const nodes=[{id:1,name:'analog1'},{id:2,name:'scale',data:{inMin:'0',inMax:'4095',outMin:'0',outMax:'50'}},{id:3,name:'cmp',data:{op:'<',value:'18'}},{id:4,name:'cmp',data:{op:'>',value:'25'}},{id:5,name:'sr'},{id:6,name:'output1'}];
const links=[[1,2],[2,3],[2,4],[3,5],[4,5],[5,6]];
const fbd=program(nodes,links);
// replicar html/inputs como lo hace Drawflow (aprox. minima)
Object.values(fbd.drawflow.Home.data).forEach(n=>{n.html='<div class="title-box">'+n.name+'</div><input type="number" df-value value="0" style="width:60px">';n.inputs={input_1:{connections:[]},input_2:{connections:[]}};});
const ir=C.compileFBD(fbd);
const env={format:'plc_program',version:2,fbd:fbd,ir:ir,drawflow:fbd.drawflow,symbolTable:ir.meta.symbolTable};
const txt=JSON.stringify(env);
console.log('Programa de 6 nodos: envelope guardado =',txt.length,'bytes; solo drawflow =',JSON.stringify({drawflow:fbd.drawflow}).length,'bytes');
const e=est(env), e2=est({drawflow:fbd.drawflow});
console.log('Estimacion ArduinoJson 32-bit: envelope =',e.bytes,'B (limite DynamicJsonDocument = 8192) | solo drawflow =',e2.bytes,'B');
// crecimiento por nodo
for(const n of [6,12,20,30]){ const ns=[];const ls=[]; for(let i=1;i<=n;i++){ns.push({id:i,name:i%3?'and':'ton',data:{time:'1000'}}); if(i>1)ls.push([i-1,i]);}
  const f=program(ns,ls);Object.values(f.drawflow.Home.data).forEach(x=>{x.html='<div>'+x.name+'<br><input type="number" df-time value="1000" style="width:60px"> ms</div>';x.inputs={input_1:{connections:[]},input_2:{connections:[]}};});
  const i2=C.compileFBD(f);const en={format:'plc_program',version:2,fbd:f,ir:i2,drawflow:f.drawflow,symbolTable:i2.meta.symbolTable};
  console.log(`n=${n} nodos: JSON=${JSON.stringify(en).length} B, estimado RAM ArduinoJson=${est(en).bytes} B ${est(en).bytes>8192?'> 8192 => NoMemory':'ok'}`);}
