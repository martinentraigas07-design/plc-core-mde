'use strict';
// Arranque de ladder.html en jsdom con el simulador REAL de la página (js/simulator/*): /load, /save, /plc/* los atiende
// el interceptor del simulador sobre un localStorage en memoria. Sirve para t_ui, t_e4_compat y t_e4_protect.
const path=require('path');
const R=process.env.REPO||path.resolve(__dirname,'..');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||(require('fs').existsSync(__dirname+'/node_modules/jsdom')?__dirname+'/node_modules/jsdom':'/tmp/jsd/node_modules/jsdom'));
function mkStore(init,log){ const m=Object.assign({},init||{}); return {getItem:k=>(k in m?m[k]:null),setItem:(k,v)=>{m[k]=String(v);log&&log.push(k);},removeItem:k=>{delete m[k];},clear:()=>{},key:()=>null,get length(){return Object.keys(m).length;},_m:m}; }
// opts: {ls:{plc_program:'...'}, ss:{ld_pro_v2:'...'}}  (valores ya serializados)
function boot(opts){
  opts=opts||{}; const lsLog=[],calls=[];
  return new Promise((resolve,reject)=>{
    JSDOM.fromFile(path.join(R,'ladder.html'),{runScripts:'dangerously',resources:'usable',virtualConsole:new VirtualConsole(),pretendToBeVisual:true,
      beforeParse(w){
        w.confirm=()=>true; w.alert=()=>{};
        Object.defineProperty(w,'localStorage',{value:mkStore(opts.ls,lsLog),configurable:true});
        Object.defineProperty(w,'sessionStorage',{value:mkStore(opts.ss),configurable:true});
        w.fetch=function(){ return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve(''),json:()=>Promise.resolve({})}); };
      }}).then(dom=>{
        const w=dom.window; const t=setTimeout(()=>reject(new Error('timeout boot')),20000);
        w.addEventListener('load',()=>{ setTimeout(()=>{ clearTimeout(t);
          // desde aquí se registra TODA llamada de red de la página (incluido /save)
          const orig=w.fetch; w.fetch=function(u,o){ calls.push({url:String(u),method:(o&&o.method)||'GET'}); return orig.apply(w,arguments); };
          resolve({dom,w,calls,lsLog,saved:()=>w.localStorage._m.plc_program,draft:()=>w.sessionStorage._m.ld_pro_v2,
            saves:()=>calls.filter(c=>c.url.split('?')[0]==='/save'&&c.method==='POST').length}); },400); });
      }).catch(reject);
  });
}
const tick=ms=>new Promise(r=>setTimeout(r,ms||50));
function contact(w,tool,rid,pi,ci,addr){ w.placeTool(tool,rid,pi,ci); w.document.getElementById('mdl-addr').value=addr; w.confirmModal(); }
function coil(w,rid,addr,mode){ w.placeTool(mode==='SET'?'SET':mode==='RESET'?'RESET':'COIL',rid,0,0); w.document.getElementById('mdl-addr').value=addr; w.confirmModal(); }
function fileOf(w,txt,name){ return {files:[new w.File([txt],name||'p.json')],value:''}; }
async function importText(S,txt){ S.w.importJSON(fileOf(S.w,txt)); await tick(300); }
module.exports={boot,tick,contact,coil,importText,mkStore};
