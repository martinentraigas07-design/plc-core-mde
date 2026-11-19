'use strict';
const fs=require('fs'),path=require('path');
const R=process.env.REPO||require('path').resolve(__dirname,'..');
const H=require('./harness');
global.window=global; 
const ST=require(path.join(R,'js/compiler/symbol_table.js')); global.PlcSymbolTable=ST;
const LP=require(path.join(R,'js/compiler/ladder_program.js')); global.LadderProgram=LP;
const C=require(path.join(R,'js/compiler/compiler.js'));
const D=require(path.join(R,'js/compiler/ladder_decompiler.js'));
// 1) autotests propios del repo
try{ const r=LP.LadderTests.runAll(); console.log('autotests ladder_program.js: passed=',r.passed,'failed=',r.failed);
  (r.results||[]).filter(x=>!x.ok&&!x.pass&&x.passed!==true).slice(0,8).forEach(x=>console.log('  FAIL',JSON.stringify(x).slice(0,200))); }catch(e){console.log('autotests no ejecutables:',e.message);}
console.log('API decompiler:',Object.keys(D));
console.log('API LadderProgram:',Object.keys(LP));
