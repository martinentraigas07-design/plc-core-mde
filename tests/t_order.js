'use strict';
// El orden que calcula el compilador (ir.order) debe ser idéntico al execOrder del firmware real.
const path=require('path');const R=process.env.REPO||require('path').resolve(__dirname,'..');
const H=require('./harness');const {program,runFirmware,runSim,check}=H;
global.window=global;global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
function rng(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);}
const t1=['not','ton','tof','tp','blink','r_trig','f_trig','scale','pwm','output1','output2'],t2=['and','or','xor','cmp','sr','rs','ctu','ctd'];
let bad=0,N=300,first=null,withCycles=0;
for(let seed=1;seed<=N;seed++){
  const Rn=rng(seed*104729),pick=a=>a[Math.floor(Rn()*a.length)];
  const cnt=4+Math.floor(Rn()*9),nodes=[{id:1,name:'input1'},{id:2,name:'input2'},{id:3,name:'analog1'}];
  const ids=[...Array(cnt).keys()].map(i=>i+4).sort(()=>Rn()-.5),links=[];
  ids.forEach(id=>nodes.push({id,name:Rn()<.7?pick(t2):pick(t1),data:{}}));
  const all=nodes.map(n=>n.id);
  nodes.forEach(n=>{if(['input1','input2','analog1'].includes(n.name))return;links.push([pick(all),n.id,1]);if(t2.includes(n.name))links.push([pick(all),n.id,2]);});
  const prog=program(nodes,links);
  const fw=runFirmware(prog,[['order']])[0].trim().split(/\s+/).map(Number);
  const sm=runSim(prog,[['order']])[0].trim().split(/\s+/).map(Number);
  const ir=C.compileFBD(prog),co=ir.order.map(i=>ir.program.nodes[i].id);
  if(JSON.stringify(fw)!==JSON.stringify(co)||JSON.stringify(sm)!==JSON.stringify(co)){bad++;if(!first)first=[seed,fw.join(),sm.join(),co.join()];}
}
check(`Orden de ejecución idéntico en firmware, simulador y compilador (${N} programas aleatorios con lazos)`,bad===0,bad?JSON.stringify(first):'sin diferencias');
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
