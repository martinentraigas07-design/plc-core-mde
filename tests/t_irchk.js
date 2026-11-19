'use strict';
// Fidelidad del oráculo IrCheck frente al firmware (host) y al simulador, con TODOS los tipos de nodo.
const path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
const H=require('./harness'); const {program,runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
global.LadderProgram=require(path.join(R,'js/compiler/ladder_program.js'));
const C=require(path.join(R,'js/compiler/compiler.js'));
const IC=require(path.join(R,'js/compiler/ir_check.js'));
const N=(id,name,data)=>({id,name,data:data||{}});
const progs={
 timers:[[N(1,'input1'),N(2,'input2'),N(3,'ton',{time:300}),N(4,'tof',{time:400}),N(5,'tp',{time:250}),N(6,'output1'),N(7,'output2'),N(8,'output3'),N(9,'blink',{time:200}),N(10,'output4')],
   [[1,3],[1,4],[2,5],[3,6],[4,7],[5,8],[1,9],[9,10]]],
 counters:[[N(1,'input1'),N(2,'input2'),N(3,'ctu',{value:3}),N(4,'output1'),N(5,'ctd',{value:2}),N(6,'output2'),N(7,'r_trig'),N(8,'f_trig'),N(9,'output3'),N(10,'output4')],
   [[1,3,1],[2,3,2],[1,7],[2,5,1],[1,5,2],[3,4],[5,6],[7,9],[8,10],[2,8]]],
 latch:[[N(1,'input1'),N(2,'input2'),N(3,'sr'),N(4,'rs'),N(5,'output1'),N(6,'output2'),N(7,'xor'),N(8,'output3')],
   [[1,3,1],[2,3,2],[1,4,1],[2,4,2],[3,5],[4,6],[3,7,1],[4,7,2],[7,8]]],
 analog:[[N(1,'analog1'),N(2,'scale',{inMin:0,inMax:4095,outMin:0,outMax:1000}),N(3,'cmp',{op:'>',value:500}),N(4,'output1'),N(5,'pwm',{out:1}),N(6,'cmp',{op:'<=',value:100}),N(7,'output2'),N(8,'scale',{inMin:4095,inMax:0,outMin:0,outMax:100}),N(9,'pwm',{out:2})],
   [[1,2],[2,3],[3,4],[2,5],[2,6],[6,7],[1,8],[8,9]]],
};
for(const [nm,[nodes,links]] of Object.entries(progs)){
  const prog=program(nodes,links); let ir;
  try{ir=C.compileFBD(prog);}catch(e){check('irchk '+nm+' compila',false,e.message);continue;}
  const steps=IC.genSteps(500,1234+nm.length,600);
  const o=IC.simulate(ir,steps);
  const script=[];let x=[false,false],a=-1;
  steps.forEach((s,k)=>{ if(s.x[0]!==x[0]){script.push(['in',0,s.x[0]?1:0]);} if(s.x[1]!==x[1]){script.push(['in',1,s.x[1]?1:0]);} x=s.x;
    if(s.a!==a){script.push(['ai',0,s.a]);a=s.a;}
    script.push(['adv',k===0?s.dt:s.dt-10]);script.push(['scan',1]);script.push(['print']);});
  for(const [rn,run] of [['FW',runFirmware],['SIM',runSim]]){
    let out; try{out=run(prog,script);}catch(e){check(`irchk ${nm} [${rn}]`,false,e.message);continue;}
    let bad=-1;const pwmPins={};ir.program.nodes.forEach(n=>{if(n.type==='pwm')pwmPins[n.outIdx|0]=1;});
    for(let k=0;k<steps.length&&bad<0;k++){
      const t=out[k].split(' ');const y=[1,2,3,4].map(i=>+t[i]);const p=[6,7,8,9].map(i=>+t[i]);
      for(let j=0;j<4;j++){ if(p[j]!==o[k].pwm[j]) bad=k; if(!pwmPins[j]&&y[j]!==(o[k].y[j]?1:0)) bad=k; }
    }
    check(`irchk ${nm}: oráculo == ${rn} (${steps.length} scans)`,bad<0,bad>=0?'primera diferencia en scan '+bad:'');
  }
}
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);process.exitCode=fail?1:0;
