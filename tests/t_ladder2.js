'use strict';
const path=require('path');
const R=process.env.REPO||require('path').resolve(__dirname,'..');
const H=require('./harness'); const {program,runFirmware,runSim,check}=H;
global.window=global;
global.PlcSymbolTable=require(path.join(R,'js/compiler/symbol_table.js'));
const LP=require(path.join(R,'js/compiler/ladder_program.js')); global.LadderProgram=LP;
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
const {makeProgram,makeRung,contact,edge,not,and,or,action}=LP;
const o1=o=>o.map(l=>l.split(' ')[1]).join('');
const both=(name,prog,st,exp)=>{for(const [nm,run] of [['FW',runFirmware],['SIM',runSim]]){let o;try{o=run(prog,st);}catch(e){check(`${name} [${nm}]`,false,'ERR '+e.message);continue;}
  check(`${name} [${nm}]`,exp(o),o.map(l=>l.slice(4,11)).join(' | '));}};
const compile=(p)=>C.compileLadderAST(p);   // devuelve IR + .drawflow
// ---- LD1: arranque/paro con automantenimiento (Y0 = (X0 + Y0) . /X1) ----
try{
 const p=makeProgram([makeRung('r1',and(or(contact('X0'),contact('Y0')),not(contact('X1'))),[action('coil','Y0')])]);
 const ir=compile(p);
 check('LD1 compila (auto-retencion Y0 contra si mismo)',!!ir.drawflow,'nodos='+ir.program.nodes.length+' order='+JSON.stringify(ir.order));
 const st=[['scan',2],['print'],['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
 both('LD1 arranque/paro Ladder: 0,1,1,0,0',ir.drawflow?{drawflow:ir.drawflow}:ir,st,o=>o1(o)==='01100');
}catch(e){check('LD1 compila',false,e.message);}
// ---- LD2: flanco ascendente X0 -> Y0 (pulso de 1 scan) ----
try{
 const p=makeProgram([makeRung('r1',edge('X0','R_TRIG'),[action('coil','Y0')])]);
 const ir=compile(p);
 const st=[['scan',2],['in',0,1],['scan',1],['print'],['scan',1],['print'],['scan',3],['print'],['in',0,0],['scan',2],['in',0,1],['scan',1],['print'],['scan',1],['print']];
 both('LD2 R_TRIG en Ladder: pulso solo en el scan del flanco (1,0,0,1,0)',{drawflow:ir.drawflow},st,o=>o1(o)==='10010');
}catch(e){check('LD2',false,e.message);}
// ---- LD3: SET/RESET ----
try{
 const p=makeProgram([makeRung('rs',contact('X0'),[action('set','Y0')]),makeRung('rr',contact('X1'),[action('reset','Y0')])]);
 const ir=compile(p);
 const st=[['in',0,1],['scan',3],['print'],['in',0,0],['scan',3],['print'],['in',1,1],['scan',3],['print'],['in',1,0],['scan',3],['print']];
 both('LD3 SET/RESET: 1,1,0,0',{drawflow:ir.drawflow},st,o=>o1(o)==='1100');
}catch(e){check('LD3',false,e.message);}
// (los round-trips FBD<->Ladder están en t_rt.js y t_ladder3.js)
const {pass,fail}=H.summary();console.log(`\nTOTAL pass=${pass} fail=${fail}`);
