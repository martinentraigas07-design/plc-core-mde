// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// plc_sim_scan.js — v2 (IR-based simulator, Fase 1)
//
// 1. Loop de scan: ejecuta plcScan() cada 10ms (mirrors ESP32 Core1 task)
// 2. Interceptor fetch: intercepta todas las llamadas fetch('/...')
//    que hacen program.html, ladder.html y monitor.html.
//    Devuelve respuestas simuladas — sin backend.
//
// Endpoints interceptados (mirrors web_server.cpp + PLC_CORE_MDE.ino):
//   GET  /status          → handleStatus()
//   GET  /nodes           → handleNodes()
//   GET  /api/memory      → handleMemoryGet()
//   POST /api/memory      → handleMemoryPost()
//   GET  /load            → handleLoad()
//   POST /save            → handleSave()
//   GET  /plc/run         → plcRun()
//   GET  /plc/stop        → plcStop()
//   GET  /plc/reload      → plcReload()
//   GET  /tags/get        → tags store
//   POST /tags/save       → tags store
//   GET  /wifi/toggle     → wifi toggle
// =============================================================

'use strict';

// =============================================================
// Loop de scan — 10ms, mirrors: vTaskDelay(10/portTICK_PERIOD_MS)
// =============================================================
let _scanInterval = null;

function simStart() {
  if (_scanInterval) return;
  SimState.plcMode = PLC_MODE.RUN;
  _scanInterval = setInterval(() => {
    plcScan();
  }, 10);
  console.log('[SIM] Scan loop iniciado (10ms)');
}

function simStop() {
  SimState.plcMode = PLC_MODE.STOP;
  if (_scanInterval) {
    clearInterval(_scanInterval);
    _scanInterval = null;
  }
  console.log('[SIM] Scan loop detenido');
}

// simReload — detiene el scan, carga programa, reinicia.
// Garantiza que parseProgram() siempre corra con scan parado
// y que simStart() siempre arranque desde cero limpio.
// Fixes V2: "simStart guard prevents restart after program reload"
function simReload(jsonStr) {
  simStop();                  // 1. detener scan (libera el interval)
  parseProgram(jsonStr);      // 2. parsear — runtimeClear() + _memReset() internos
  SimState.scanCount = 0;     // 3. resetear métricas
  simStart();                 // 4. arrancar scan fresco
}

// =============================================================
// /status response — mirrors handleStatus() exactamente
// =============================================================
function _buildStatus() {
  // mirrors the JSON built in handleStatus():
  // { mode, nodes, wifi, io: { in[2], ai[1], out[4] } }
  return {
    mode:  SimState.plcMode,
    nodes: SimState.nodeCount,
    wifi:  SimState.wifiEnabled,
    sim:   true,   // flag adicional para que la UI sepa que es sim
    io: {
      in:  SimState.inputs.slice(),
      ai:  SimState.analog.slice(),
      out: SimState.outputs.slice(),
    }
  };
}

// =============================================================
// /nodes response — mirrors handleNodes() exactamente
// Campos devueltos per-node: id, name, state, intValue, input1,
//   input2, preset, timerRunning + timerElapsed (calculado aquí)
// =============================================================
function _buildNodes() {
  return {
    nodes: SimState.nodes.map(n => ({
      id:           n.id,
      name:         n.name,
      state:        n.state,
      intValue:     n.intValue,
      realValue:    n.realValue,
      input1:       n.input1,
      input2:       n.input2,
      preset:       n.preset,
      timerRunning: n.timerRunning,
      timerDone:    n.timerDone,
      timerElapsed: n.timerRunning
                    ? Math.round(performance.now() - n.timerStart)
                    : 0,
      value:        n.value,
      op:           n.op,
      outIdx:       n.outIdx,
    }))
  };
}

// =============================================================
// /api/memory response — mirrors handleMemoryGet() + memoryToJSON()
// Añade scanCount + scanUs (mirrors web_server.cpp handleMemoryGet)
// =============================================================
function _buildMemory() {
  const m = SimState.mem;
  return {
    X:         m.X.map(v => v ? 1 : 0),
    Y:         m.Y.map(v => v ? 1 : 0),
    M:         m.M.map(v => v ? 1 : 0),
    T:         m.T.map(v => v ? 1 : 0),
    C:         m.C.map(v => v ? 1 : 0),
    R:         m.R.slice(),
    A:         m.A.slice(),
    scanCount: SimState.scanCount,
    scanUs:    SimState.lastScanUs,
  };
}

// =============================================================
// POST /api/memory — mirrors handleMemoryPost() + memoryPatchJSON()
// Solo soporta patch de X[] (mirrors firmware memoryPatchJSON)
// =============================================================
function _applyMemoryPatch(body) {
  let patch;
  try {
    patch = typeof body === 'string' ? JSON.parse(body) : body;
  } catch(e) {
    console.error('[SIM] /api/memory patch: JSON inválido', e);
    return false;
  }

  if (patch.X && Array.isArray(patch.X)) {
    patch.X.forEach((v, i) => {
      if (i < MEM_X_SIZE) {
        SimState.mem.X[i] = !!v;
        // También actualizar SimState.inputs para que FASE 1 del scan lo vea
        if (i < NUM_INPUTS) SimState.inputs[i] = !!v;
      }
    });
  }
  // Extensión: también soportar patch de M[] para pruebas
  if (patch.M && Array.isArray(patch.M)) {
    patch.M.forEach((v, i) => {
      if (i < MEM_M_SIZE) SimState.mem.M[i] = !!v;
    });
  }
  return true;
}

// =============================================================
// Tags store (mirrors /tags/get + /tags/save)
// =============================================================
function _defaultTags() {
  const tags = [];
  for (let i = 0; i < NUM_INPUTS;  i++) tags.push({ type:'DI',  index:i, name:`DI${i+1}`,  comment:'' });
  for (let i = 0; i < NUM_OUTPUTS; i++) tags.push({ type:'DO',  index:i, name:`DO${i+1}`,  comment:'' });
  for (let i = 0; i < NUM_ANALOG;  i++) tags.push({ type:'AI',  index:i, name:`AI${i+1}`,  comment:'' });
  for (let i = 0; i < 16; i++) tags.push({ type:'RDI', index:i, name:`RDI${i+1}`, comment:'' });
  for (let i = 0; i < 16; i++) tags.push({ type:'RDO', index:i, name:`RDO${i+1}`, comment:'' });
  for (let i = 0; i < 8;  i++) tags.push({ type:'RAI', index:i, name:`RAI${i+1}`, comment:'' });
  return { tags };
}
function _loadTags() {
  try { const r = localStorage.getItem('plc_tags'); return r ? JSON.parse(r) : _defaultTags(); }
  catch(e) { return _defaultTags(); }
}
function _saveTags(data) {
  try { localStorage.setItem('plc_tags', JSON.stringify(data)); } catch(e) {}
}

// =============================================================
// Program persistence (mirrors SPIFFS /program.json)
// =============================================================
function _persistProgram(str) {
  try { localStorage.setItem('plc_program', str); } catch(e) {}
  SimState.programJson = str;
}
function _loadPersistedProgram() {
  try { return localStorage.getItem('plc_program') || SimState.programJson; }
  catch(e) { return SimState.programJson; }
}

// =============================================================
// Helper: construir una respuesta HTTP fake
// =============================================================
function _fakeResponse(data, ok = true) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return Promise.resolve({
    ok:     ok,
    status: ok ? 200 : 400,
    json:   () => Promise.resolve(typeof data === 'string' ? {} : data),
    text:   () => Promise.resolve(body),
  });
}

// =============================================================
// PLC endpoint whitelist
// Only these paths are intercepted — everything else passes through.
// This prevents accidentally swallowing static asset requests.
// =============================================================
const _PLC_ENDPOINTS = new Set([
  '/status', '/nodes', '/api/memory', '/load', '/save',
  '/plc/run', '/plc/stop', '/plc/reload',
  '/tags/get', '/tags/save', '/wifi/toggle', '/wifi/status',
  '/modbus/status', '/modbus/discover',
]);

function _isPlcEndpoint(path) {
  return _PLC_ENDPOINTS.has(path);
}

// =============================================================
// Fetch Interceptor
// Parchea window.fetch — debe cargarse ANTES de program.html,
// ladder.html y monitor.html para que sus scripts lo vean.
//
// SOLO intercepta endpoints PLC definidos en _PLC_ENDPOINTS.
// Todos los demás requests (estáticos, externos) van al fetch real.
// =============================================================
(function installFetchInterceptor() {
  const _realFetch = window.fetch.bind(window);

  window.fetch = function(url, options) {
    const path = typeof url === 'string' ? url : (url?.url ?? '');

    // Fast exit: only intercept known PLC API endpoints
    if (!_isPlcEndpoint(path)) {
      return _realFetch(url, options);
    }

    // ── GET /status ──────────────────────────────────────────
    if (path === '/status') {
      return _fakeResponse(_buildStatus());
    }

    // ── GET /nodes ───────────────────────────────────────────
    if (path === '/nodes') {
      return _fakeResponse(_buildNodes());
    }

    // ── GET /api/memory ──────────────────────────────────────
    if (path === '/api/memory' && (!options || options.method !== 'POST')) {
      return _fakeResponse(_buildMemory());
    }

    // ── POST /api/memory ─────────────────────────────────────
    if (path === '/api/memory' && options?.method === 'POST') {
      const body = options.body;
      const ok = _applyMemoryPatch(body);
      return _fakeResponse(ok ? 'OK' : 'JSON invalido', ok);
    }

    // ── GET /load ────────────────────────────────────────────
    // mirrors handleLoad(): devuelve {} si no hay programa
    if (path === '/load') {
      const prog = _loadPersistedProgram();
      return _fakeResponse(prog || '{}');
    }

    // ── POST /save ───────────────────────────────────────────
    // mirrors handleSave(): guarda, parsea, arranca RUN
    if (path === '/save') {
      const body = options?.body;
      if (body) {
        try {
          const str = typeof body === 'string' ? body : JSON.stringify(body);
          _persistProgram(str);
          simReload(str);   // stop → parseProgram+reset → start
          console.log('[SIM] Programa guardado y cargado');
          if (typeof simPanelRefresh === 'function') simPanelRefresh();
        } catch(e) {
          console.error('[SIM] /save error:', e);
        }
      }
      return _fakeResponse('OK');
    }

    // ── GET /plc/run ─────────────────────────────────────────
    if (path === '/plc/run') {
      simStart();
      console.log('[SIM] PLC → RUN');
      return _fakeResponse('RUN');
    }

    // ── GET /plc/stop ────────────────────────────────────────
    if (path === '/plc/stop') {
      simStop();
      console.log('[SIM] PLC → STOP');
      return _fakeResponse('STOP');
    }

    // ── GET /plc/reload ──────────────────────────────────────
    // mirrors plcReload(): recarga programa y arranca RUN
    if (path === '/plc/reload') {
      const prog = _loadPersistedProgram();
      if (prog && prog !== '{}') {
        simReload(prog);    // stop → parseProgram+reset → start
        console.log('[SIM] PLC recargado');
      }
      return _fakeResponse('RELOAD');
    }

    // ── GET /tags/get ────────────────────────────────────────
    if (path === '/tags/get') {
      return _fakeResponse(_loadTags());
    }

    // ── POST /tags/save ──────────────────────────────────────
    if (path === '/tags/save') {
      const body = options?.body;
      if (body) {
        try {
          const data = typeof body === 'string' ? JSON.parse(body) : body;
          _saveTags(data);
        } catch(e) {}
      }
      return _fakeResponse({ ok: true });
    }

    // ── GET /wifi/toggle ─────────────────────────────────────
    if (path === '/wifi/toggle') {
      SimState.wifiEnabled = !SimState.wifiEnabled;
      return _fakeResponse({ wifi: SimState.wifiEnabled });
    }

    // ── GET /wifi/status ─────────────────────────────────────
    if (path === '/wifi/status') {
      return _fakeResponse({ wifi: SimState.wifiEnabled, sim: true });
    }

    // ── GET /modbus/status ────────────────────────────────────
    // mirrors modbusGetStatus() in plc_modbus.cpp
    if (path === '/modbus/status') {
      return _fakeResponse({
        discovery: SimState.mbDiscoveryDone,
        slaves: (SimState.mbSlaves || []).map(s => ({
          addr:       s.address,
          label:      s.label,
          type:       s.type,
          online:     s.online,
          discovered: s.discovered,
          di: s.numDI, do: s.numDO, ai: s.numAI, ao: s.numAO,
          rdiOff: s.rdiOff, rdoOff: s.rdoOff,
          raiOff: s.raiOff, raoOff: s.raoOff,
          polls:  s.pollCount,
          errors: s.errorCount,
        }))
      });
    }

    // ── GET /modbus/discover ──────────────────────────────────
    // mirrors modbusStartDiscovery() + modbusPoll() loop
    // In sim: instantaneous, with 500ms simulated latency
    if (path === '/modbus/discover') {
      if (typeof simStartDiscovery === 'function') {
        simStartDiscovery(); // resets mbDiscoveryDone, fires after 500ms
      }
      return _fakeResponse({ status: 'discovery_started' });
    }

    // ── Fallback para endpoints en whitelist no implementados ─
    // (no debería llegar aquí si la whitelist está correcta)
    console.warn('[SIM] Endpoint en whitelist sin handler:', path);
    return _fakeResponse({ error: 'sim: handler missing', path }, false);
  };

  console.log('[SIM] Fetch interceptor instalado');
})();

// =============================================================
// Boot sequence — corre una vez al cargar el DOM
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Marcar body con clase para CSS (no invasivo, no modifica layout)
  document.body.classList.add('simulation-mode');

  // Intentar restaurar programa guardado
  const saved = _loadPersistedProgram();
  if (saved && saved !== '{}') {
    try {
      simReload(saved);   // stop → parseProgram+reset → start
      console.log('[SIM] Programa restaurado, auto-iniciado');
    } catch(e) {
      console.warn('[SIM] No se pudo restaurar el programa:', e);
    }
  }

  // Mostrar banner del simulador si existe en el HTML del editor
  const banner = document.getElementById('sim-banner');
  if (banner) banner.style.display = 'flex';

  console.log('[SIM] Boot completo. Simulador listo.');
});
