/* PLC-CORE-MDE — Adaptador de API para el servidor embebido (ESP32)
   Se carga SOLO en la versión que sirve el ESP32 (tools/build_web.js lo inyecta después de plc_api.js).
   El firmware no implementa /api/memory (el simulador sí): aquí se arma el mismo objeto
   {X,Y,M,T,C,R,A,scanCount,scanUs} a partir de /status y /nodes, con el mismo mapeo que
   simulator/plc_sim_runtime.js (bloque "MEMORY SYNC"). No hay forzado de entradas físicas:
   patchMemory/toggleInput se rechazan (las entradas reales no se pueden forzar desde la web). */
(function (root) {
  'use strict';
  var Api = root.PlcApi;
  if (!Api) { return; }
  var MEM = { X: 64, Y: 64, M: 64, T: 32, C: 32, R: 32, A: 16 };
  var TTL = 250;                       // ms: comparte /status y /nodes entre getStatus/getNodes/getMemory
  var cache = {};
  function get(p) {
    var c = cache[p], now = Date.now();
    if (c && (c.pending || now - c.t < TTL)) return c.pr;
    var pr = fetch(p).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    c = cache[p] = { t: now, pr: pr, pending: true };
    var done = function () { c.pending = false; c.t = Date.now(); };
    pr.then(done, function () { delete cache[p]; });
    return pr;
  }
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function outIndex(nm) { var m = /^output([1-4])$/.exec(nm); return m ? +m[1] - 1 : -1; }
  function analogIndex(nm) { return nm === 'analog1' ? 0 : -1; }
  function build(st, nd) {
    var m = { X: zeros(MEM.X), Y: zeros(MEM.Y), M: zeros(MEM.M), T: zeros(MEM.T), C: zeros(MEM.C), R: zeros(MEM.R), A: zeros(MEM.A) };
    var io = (st && st.io) || {};
    (io.in || []).forEach(function (v, i) { if (i < MEM.X) m.X[i] = v ? 1 : 0; });
    (io.ai || []).forEach(function (v, i) { if (i < MEM.A) m.A[i] = v | 0; });
    (io.out || []).forEach(function (v, i) { if (i < MEM.Y) m.Y[i] = v ? 1 : 0; });
    ((nd && nd.nodes) || []).forEach(function (n) {
      var nm = n.name, s = n.state ? 1 : 0;
      var yi = outIndex(nm); if (yi >= 0 && yi < MEM.Y) m.Y[yi] = s;
      var ai = analogIndex(nm); if (ai >= 0 && ai < MEM.A) m.A[ai] = n.intValue | 0;
      if (nm === 'ton' || nm === 'tof' || nm === 'tp' || nm === 'blink') {
        m.T[n.id % MEM.T] = s;
        m.R[n.id % MEM.R] = (n.timerElapsed | 0);       // el firmware no informa el tiempo transcurrido: 0
      }
      if (nm === 'ctu' || nm === 'ctd') {
        m.C[n.id % MEM.C] = s;
        m.R[(n.id + 16) % MEM.R] = n.intValue | 0;
      }
      if (nm === 'sr' || nm === 'rs' || nm === 'r_trig' || nm === 'f_trig' || nm === 'and' ||
          nm === 'or' || nm === 'not' || nm === 'xor' || nm === 'cmp') {
        m.M[n.id % MEM.M] = s;
      }
    });
    m.scanCount = 0; m.scanUs = 0;                       // el firmware no expone estas métricas
    return m;
  }
  Api.getStatus = function () { return get('/status'); };
  Api.getNodes = function () { return get('/nodes'); };
  Api.getMemory = function () {
    return Promise.all([get('/status'), get('/nodes').catch(function () { return { nodes: [] }; })])
      .then(function (r) { return build(r[0], r[1]); });
  };
  Api.patchMemory = function () {
    return Promise.reject(new Error('Las entradas físicas del PLC no se pueden forzar desde la web'));
  };
  Api.toggleInput = Api.patchMemory;
  Api._espBuildMemory = build;                           // para pruebas
  Api.isEmbedded = true;
}(typeof self !== 'undefined' ? self : this));
if (typeof module !== 'undefined' && module.exports) { /* solo navegador */ }
