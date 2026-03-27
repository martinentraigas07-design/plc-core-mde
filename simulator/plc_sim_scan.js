// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// Argentina
// Licensed under PLC-CORE-MDE License v1.0
// Educational use allowed
// Commercial use requires authorization
// =============================================================

// =============================================================
// plc_sim_scan.js — PLC-CORE-MDE Cloud Simulator
//
// 1. Scan loop: runs plcScan() every 10ms via setInterval
// 2. Fetch interceptor: intercepts all fetch('/...') calls
//    made by program.html and monitor.html and returns simulated
//    responses — NO backend required.
//
// Intercepted endpoints:
//   GET  /status           → SimState summary
//   GET  /nodes            → node table
//   GET  /plc/run          → set mode RUN
//   GET  /plc/stop         → set mode STOP
//   GET  /plc/reload       → reload program from localStorage
//   POST /save             → save program JSON
//   GET  /modbus/discover  → trigger discovery
//   GET  /modbus/status    → return slave list
//   GET  /wifi/toggle      → toggle wifi flag
//   GET  /tags/get         → return stored tags
//   POST /tags/save        → save tags to localStorage
// =============================================================

'use strict';

// =============================================================
// Scan loop — 10ms cycle, mirrors ESP32 Core1 task
// =============================================================
let _scanInterval = null;

function simStart() {
  if (_scanInterval) return;
  _scanInterval = setInterval(() => {
    modbusPoll();
    plcScan();
  }, 10);
  console.log('[SIM] Scan loop started (10ms)');
}

function simStop() {
  if (_scanInterval) {
    clearInterval(_scanInterval);
    _scanInterval = null;
  }
  console.log('[SIM] Scan loop stopped');
}

// =============================================================
// Simulated tags store
// =============================================================
function _defaultTags() {
  const tags = [];
  for (let i = 0; i < 2;  i++) tags.push({ type:'DI',  index:i, name:`DI${i+1}`,  comment:'' });
  for (let i = 0; i < 4;  i++) tags.push({ type:'DO',  index:i, name:`DO${i+1}`,  comment:'' });
  for (let i = 0; i < 1;  i++) tags.push({ type:'AI',  index:i, name:`AI${i+1}`,  comment:'' });
  for (let i = 0; i < 16; i++) tags.push({ type:'RDI', index:i, name:`RDI${i+1}`, comment:'' });
  for (let i = 0; i < 16; i++) tags.push({ type:'RDO', index:i, name:`RDO${i+1}`, comment:'' });
  for (let i = 0; i < 8;  i++) tags.push({ type:'RAI', index:i, name:`RAI${i+1}`, comment:'' });
  return { tags };
}

function _loadTags() {
  try {
    const raw = localStorage.getItem('plc_tags');
    return raw ? JSON.parse(raw) : _defaultTags();
  } catch(e) { return _defaultTags(); }
}

function _saveTags(data) {
  try { localStorage.setItem('plc_tags', JSON.stringify(data)); } catch(e) {}
}

// =============================================================
// Build /status response — mirrors ESP32 web_server.cpp /status
// =============================================================
function _buildStatus() {
  return {
    mode:  SimState.plcMode,
    nodes: SimState.nodeCount,
    wifi:  SimState.wifiEnabled,
    sim:   true,
    io: {
      in:  SimState.inputs.map(v => v ? 1 : 0),
      out: SimState.outputs.map(v => v ? 1 : 0),
      ai:  SimState.analog.slice(),
      pwm: SimState.pwmValues.slice(),
    }
  };
}

// =============================================================
// Build /nodes response — mirrors ESP32 /nodes endpoint
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
      timerElapsed: n.timerRunning ? Math.round(performance.now() - n.timerStart) : 0,
      counterVal:   n.intValue,
      op:           n.op,
      outIdx:       n.outIdx,
      value:        n.value,
    }))
  };
}

// =============================================================
// Helper: make a fake Response object
// =============================================================
function _fakeResponse(data, ok) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return Promise.resolve({
    ok: ok !== false,
    status: ok !== false ? 200 : 400,
    json: () => Promise.resolve(typeof data === 'string' ? {} : data),
    text: () => Promise.resolve(body),
  });
}

// =============================================================
// Fetch interceptor
// Patches window.fetch — must be loaded BEFORE program.html and
// monitor.html inline scripts run.
// =============================================================
(function() {
  const _realFetch = window.fetch.bind(window);

  window.fetch = function(url, options) {
    const path = typeof url === 'string' ? url : (url && url.url) || '';

    // ---- /status ----
    if (path === '/status') {
      return _fakeResponse(_buildStatus());
    }

    // ---- /nodes ----
    if (path === '/nodes') {
      return _fakeResponse(_buildNodes());
    }

    // ---- /plc/run ----
    if (path === '/plc/run') {
      SimState.plcMode = PLC_MODE.RUN;
      simStart();
      console.log('[SIM] PLC → RUN');
      return _fakeResponse({ ok: true, mode: 'RUN' });
    }

    // ---- /plc/stop ----
    if (path === '/plc/stop') {
      SimState.plcMode = PLC_MODE.STOP;
      console.log('[SIM] PLC → STOP');
      return _fakeResponse({ ok: true, mode: 'STOP' });
    }

    // ---- /plc/reload ----
    if (path === '/plc/reload') {
      const prog = _loadProgram();
      if (prog) {
        parseProgram(prog);
        SimState.plcMode = PLC_MODE.RUN;
        simStart();
        console.log('[SIM] PLC reloaded');
      }
      return _fakeResponse({ ok: true });
    }

    // ---- /save (POST) ----
    if (path === '/save') {
      const body = options && options.body;
      if (body) {
        try {
          const str = typeof body === 'string' ? body : JSON.stringify(body);
          localStorage.setItem('plc_program', str);
          parseProgram(str);
          SimState.plcMode = PLC_MODE.RUN;
          simStart();
          console.log('[SIM] Program saved & loaded');
          // Notify panel to refresh
          if (typeof simPanelRefresh === 'function') simPanelRefresh();
        } catch(e) { console.error('[SIM] Save error:', e); }
      }
      return _fakeResponse('OK');
    }

    // ---- /modbus/discover ----
    if (path === '/modbus/discover') {
      modbusStartDiscovery(() => {
        if (typeof modbusPanelRefresh === 'function') modbusPanelRefresh();
      });
      return _fakeResponse({ ok: true });
    }

    // ---- /modbus/status ----
    if (path === '/modbus/status') {
      return _fakeResponse(modbusGetStatusJson());
    }

    // ---- /wifi/toggle ----
    if (path === '/wifi/toggle') {
      SimState.wifiEnabled = !SimState.wifiEnabled;
      return _fakeResponse({ wifi: SimState.wifiEnabled });
    }

    // ---- /tags/get ----
    if (path === '/tags/get') {
      return _fakeResponse(_loadTags());
    }

    // ---- /tags/save (POST) ----
    if (path === '/tags/save') {
      const body = options && options.body;
      if (body) {
        try {
          const data = typeof body === 'string' ? JSON.parse(body) : body;
          _saveTags(data);
        } catch(e) {}
      }
      return _fakeResponse({ ok: true });
    }

    // ---- Anything else: let it through (static assets, etc.) ----
    // Only intercept absolute paths that look like API calls
    if (path.startsWith('/') && !path.includes('.')) {
      console.warn('[SIM] Unhandled API call:', path);
      return _fakeResponse({ error: 'sim: not implemented', path }, false);
    }

    return _realFetch(url, options);
  };

  console.log('[SIM] Fetch interceptor installed');
})();

// =============================================================
// Program persistence helpers
// =============================================================
function _loadProgram() {
  try { return localStorage.getItem('plc_program'); } catch(e) { return null; }
}

// =============================================================
// Boot sequence — runs once when DOM is ready
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  modbusInit();

  // Try to restore saved program
  const saved = _loadProgram();
  if (saved) {
    try {
      parseProgram(saved);
      SimState.plcMode = PLC_MODE.RUN;
      simStart();
      console.log('[SIM] Restored saved program, auto-started');
    } catch(e) {
      console.warn('[SIM] Could not restore saved program:', e);
    }
  }

  // Show sim banner
  const banner = document.getElementById('sim-banner');
  if (banner) banner.style.display = 'flex';

  console.log('[SIM] Boot complete. Simulator ready.');
});
