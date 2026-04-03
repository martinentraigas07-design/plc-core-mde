/* PLC-CORE-MDE — API Layer v2 */
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PlcApi = factory();
}(typeof self !== 'undefined' ? self : this, function() {

  function _get(p) {
    return fetch(p).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status); return r.json();
    });
  }
  function _post(p, body, text) {
    return fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},
      body: typeof body==='string'?body:JSON.stringify(body)
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return text ? r.text() : r.json().catch(function(){return r.text();});
    });
  }

  function getMemory()        { return _get('/api/memory'); }
  function patchMemory(p)     { return _post('/api/memory', p, true); }
  function toggleInput(i, x)  {
    if (x) {
      var n=x.slice(); n[i]=n[i]?0:1; return patchMemory({X:n});
    }
    return getMemory().then(function(m){ var n=(m.X||[]).slice(); n[i]=n[i]?0:1; return patchMemory({X:n}); });
  }
  function getStatus()  { return _get('/status'); }
  function getNodes()   { return _get('/nodes'); }
  function plcRun()     { return fetch('/plc/run').then(function(r){return r.text();}); }
  function plcStop()    { return fetch('/plc/stop').then(function(r){return r.text();}); }
  function plcReload()  { return fetch('/plc/reload').then(function(r){return r.text();}); }
  function saveProgram(ir) {
    return fetch('/save',{method:'POST',body:typeof ir==='string'?ir:JSON.stringify(ir)}).then(function(r){return r.text();});
  }

  return {getMemory:getMemory,patchMemory:patchMemory,toggleInput:toggleInput,
          getStatus:getStatus,getNodes:getNodes,
          plcRun:plcRun,plcStop:plcStop,plcReload:plcReload,saveProgram:saveProgram};
}));
