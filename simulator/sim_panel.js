// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// sim_panel.js — v2 (IR-based simulator, Fase 1)
//
// Panel flotante de IO del simulador.
// Se inyecta en program.html, ladder.html y monitor.html.
//
// NO modifica la UI existente — se agrega encima como overlay.
// Refresca a 10Hz leyendo SimState directamente.
//
// Secciones:
//   Header  — modo RUN/STOP + scan counter
//   INPUTS  — toggle DI0, DI1 (SimState.inputs[])
//   ANALOG  — slider AI0 0-4095 (SimState.analog[])
//   OUTPUTS — LEDs DO0-DO3 + barras PWM (SimState.outputs[])
//   TIMERS  — estado Q + ET de cada timer node activo
//   COUNTERS— estado Q + CV/PV de cada counter node activo
// =============================================================

// sim_panel.js opera sin 'use strict' global para no interferir
// con editores existentes. Las funciones expuestas son globales
// por diseño — los editores las llaman por nombre.

// =============================================================
// simPanelInject — crea el panel y lo agrega al DOM
// =============================================================
function simPanelInject() {
  if (document.getElementById('sim-panel')) return; // idempotente

  const panel = document.createElement('div');
  panel.id = 'sim-panel';
  panel.innerHTML = `
    <div class="sim-panel-inner" id="sim-panel-inner">

      <!-- Header -->
      <div class="sim-section-title" id="sim-drag-handle">
        <span class="sim-dot" id="sim-run-dot"></span>
        <span style="font-size:9px;letter-spacing:3px;">SIMULATOR</span>
        <span class="sim-mode-tag" id="sim-mode-tag">STOP</span>
        <button class="sim-collapse-btn" id="sim-collapse-btn" title="Colapsar">▲</button>
      </div>

      <div id="sim-panel-body">

        <!-- INPUTS -->
        <div class="sim-sub-title">ENTRADAS DIGITALES</div>
        <div class="sim-io-row">
          <button class="sim-input-btn off" id="sim-in-0"
                  onclick="simToggleInput(0)"
                  onmousedown="simPressInput(0,true)"
                  onmouseup="simPressInput(0,false)"
                  onmouseleave="simPressInput(0,false)"
                  ontouchstart="simPressInput(0,true)"
                  ontouchend="simPressInput(0,false)">
            <span class="sim-led" id="sim-led-in0"></span>
            <span>DI0</span>
            <span class="sim-tag">input1</span>
          </button>
          <button class="sim-input-btn off" id="sim-in-1"
                  onclick="simToggleInput(1)"
                  onmousedown="simPressInput(1,true)"
                  onmouseup="simPressInput(1,false)"
                  onmouseleave="simPressInput(1,false)"
                  ontouchstart="simPressInput(1,true)"
                  ontouchend="simPressInput(1,false)">
            <span class="sim-led" id="sim-led-in1"></span>
            <span>DI1</span>
            <span class="sim-tag">input2</span>
          </button>
        </div>
        <div class="sim-hint">Click = toggle | Mantener = momentáneo</div>

        <!-- ANALOG -->
        <div class="sim-sub-title" style="margin-top:8px;">ENTRADA ANALÓGICA</div>
        <div class="sim-analog-row">
          <div class="sim-analog-header">
            <span>AI0 <span class="sim-tag">analog1</span></span>
            <span id="sim-ai-val" style="color:var(--accent2);">0</span>
          </div>
          <input type="range" min="0" max="4095" value="0" id="sim-ai-0"
                 class="sim-slider"
                 oninput="simSetAnalog(0, parseInt(this.value))">
          <div class="sim-scale-marks">
            <span>0</span><span>2048</span><span>4095</span>
          </div>
        </div>

        <!-- OUTPUTS -->
        <div class="sim-sub-title" style="margin-top:8px;">SALIDAS DIGITALES</div>
        <div class="sim-io-row">
          <div class="sim-out-cell">
            <span class="sim-out-led" id="sim-led-out0"></span>
            <span>DO0</span>
          </div>
          <div class="sim-out-cell">
            <span class="sim-out-led" id="sim-led-out1"></span>
            <span>DO1</span>
          </div>
          <div class="sim-out-cell">
            <span class="sim-out-led" id="sim-led-out2"></span>
            <span>DO2</span>
          </div>
          <div class="sim-out-cell">
            <span class="sim-out-led" id="sim-led-out3"></span>
            <span>DO3</span>
          </div>
        </div>

        <!-- PWM -->
        <div class="sim-sub-title" style="margin-top:8px;">PWM</div>
        <div id="sim-pwm-bars">
          ${[0,1,2,3].map(i => `
          <div class="sim-pwm-row">
            <span class="sim-pwm-lbl">OUT${i}</span>
            <div class="sim-pwm-track"><div class="sim-pwm-fill" id="sim-pwm-${i}"></div></div>
            <span class="sim-pwm-val" id="sim-pwm-val-${i}">0</span>
          </div>`).join('')}
        </div>

        <!-- TIMERS (dinámico) -->
        <div id="sim-timers-wrap" style="display:none;">
          <div class="sim-sub-title" style="margin-top:8px;">TIMERS</div>
          <div id="sim-timers-body"></div>
        </div>

        <!-- COUNTERS (dinámico) -->
        <div id="sim-counters-wrap" style="display:none;">
          <div class="sim-sub-title" style="margin-top:8px;">COUNTERS</div>
          <div id="sim-counters-body"></div>
        </div>

        <!-- RS485 SIMULATION -->
        <div class="sim-sub-title" style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;">
          <span>RS485 SIMULATION</span>
          <button class="sim-rs485-add-btn" id="sim-rs485-add-btn" onclick="simModuleAddPrompt()" title="Add module">+</button>
        </div>
        <!-- Add form (hidden by default) -->
        <div id="sim-rs485-form" style="display:none;margin-bottom:6px;">
          <select id="sim-rs485-type" class="sim-rs485-select">
            <option value="MOD_WS_IO8">WS-IO8 (8DI+8DO)</option>
            <option value="MOD_WS_RELAY8">WS-RELAY8 (8DO)</option>
            <option value="MOD_WS_AI8">WS-AI8 (8AI)</option>
            <option value="MOD_WS_AO8">WS-AO8 (8AO)</option>
            <option value="MOD_MDE_DI16">MDE-DI16 (16DI)</option>
            <option value="MOD_MDE_DO16">MDE-DO16 (16DO)</option>
            <option value="MOD_MDE_AI8">MDE-AI8 (8AI)</option>
          </select>
          <div style="display:flex;gap:4px;margin-top:4px;">
            <input id="sim-rs485-addr" type="number" min="1" max="247" value="1"
                   class="sim-rs485-input" placeholder="Addr 1-247">
            <button class="sim-rs485-ok-btn" onclick="simModuleAddConfirm()">ADD</button>
            <button class="sim-rs485-cancel-btn" onclick="simModuleAddCancel()">&#x2715;</button>
          </div>
        </div>
        <!-- Module list -->
        <div id="sim-rs485-body"></div>

        <!-- Stats footer -->
        <div class="sim-stats">
          <span>SCANS: <b id="sim-scan-cnt">0</b></span>
          <span id="sim-scan-us" style="color:var(--text-dim)">0µs</span>
          <span>MODE: <b id="sim-stat-mode">STOP</b></span>
        </div>

      </div><!-- /sim-panel-body -->
    </div>
  `;

  document.body.appendChild(panel);
  _injectSimStyles();
  _injectRS485Styles();
  _makeSimPanelDraggable();
  _makeSimPanelCollapsible();
}

// =============================================================
// simPanelRefresh — actualiza el panel en tiempo real
// Llamado por setInterval (10Hz) y por handlers de IO.
// Lee directamente de SimState — sin fetch.
// =============================================================
function simPanelRefresh() {
  // ── Modo ────────────────────────────────────────────────────
  const isRun    = SimState.plcMode === PLC_MODE.RUN;
  const modeTag  = document.getElementById('sim-mode-tag');
  const statMode = document.getElementById('sim-stat-mode');
  const dot      = document.getElementById('sim-run-dot');

  if (modeTag)  { modeTag.textContent  = SimState.plcMode; }
  if (statMode) {
    statMode.textContent = SimState.plcMode;
    statMode.style.color = isRun ? 'var(--green)' : 'var(--accent)';
  }
  if (dot) {
    dot.style.background  = isRun ? 'var(--green)' : 'var(--accent)';
    dot.style.boxShadow   = isRun
      ? '0 0 8px var(--green)'
      : '0 0 4px var(--accent)';
    dot.style.animation   = isRun ? 'sim-dot-pulse 1.2s infinite' : 'none';
  }

  // ── Entradas digitales ───────────────────────────────────────
  SimState.inputs.forEach((val, i) => {
    const btn = document.getElementById(`sim-in-${i}`);
    const led = document.getElementById(`sim-led-in${i}`);
    if (btn) btn.className = 'sim-input-btn ' + (val ? 'on' : 'off');
    if (led) led.className = 'sim-led ' + (val ? 'on' : '');
  });

  // ── Analógico ────────────────────────────────────────────────
  const aiVal = document.getElementById('sim-ai-val');
  if (aiVal) aiVal.textContent = SimState.analog[0] ?? 0;

  // ── Salidas digitales ────────────────────────────────────────
  SimState.outputs.forEach((val, i) => {
    const led = document.getElementById(`sim-led-out${i}`);
    if (led) led.className = 'sim-out-led ' + (val ? 'on' : '');
  });

  // ── PWM ──────────────────────────────────────────────────────
  SimState.pwmValues.forEach((val, i) => {
    const fill = document.getElementById(`sim-pwm-${i}`);
    const valEl = document.getElementById(`sim-pwm-val-${i}`);
    if (fill)  fill.style.width  = Math.round(val / 4095 * 100) + '%';
    if (valEl) valEl.textContent = val;
  });

  // ── Timers (nodos activos en el programa) ────────────────────
  _refreshTimers();

  // ── Counters ─────────────────────────────────────────────────
  _refreshCounters();

  // RS485 modules refresh
  _refreshRS485();

  // ── Métricas ─────────────────────────────────────────────────
  const scanCnt = document.getElementById('sim-scan-cnt');
  const scanUs  = document.getElementById('sim-scan-us');
  if (scanCnt) scanCnt.textContent = SimState.scanCount;
  if (scanUs)  scanUs.textContent  = SimState.lastScanUs + 'µs';
}

// ── Timers dinámicos ─────────────────────────────────────────
function _refreshTimers() {
  const TIMER_NAMES = ['ton', 'tof', 'tp', 'blink'];
  const timerNodes  = SimState.nodes.filter(n => TIMER_NAMES.includes(n.name));
  const wrap   = document.getElementById('sim-timers-wrap');
  const body   = document.getElementById('sim-timers-body');
  if (!wrap || !body) return;

  wrap.style.display = timerNodes.length ? '' : 'none';
  if (!timerNodes.length) return;

  // Reconstruir sólo si cambió la cantidad de nodos timer
  if (body.dataset.count !== String(timerNodes.length)) {
    body.dataset.count = timerNodes.length;
    body.innerHTML = timerNodes.map((n, i) => `
      <div class="sim-timer-row">
        <span class="sim-timer-name">${n.name.toUpperCase()}[${i}]</span>
        <span class="sim-timer-q" id="sim-tq-${i}">Q=0</span>
        <div class="sim-timer-bar-bg">
          <div class="sim-timer-bar-fill" id="sim-tb-${i}"></div>
        </div>
        <span class="sim-timer-et" id="sim-tet-${i}">0ms</span>
      </div>`).join('');
  }

  // Actualizar valores
  timerNodes.forEach((n, i) => {
    const q   = document.getElementById(`sim-tq-${i}`);
    const bar = document.getElementById(`sim-tb-${i}`);
    const et  = document.getElementById(`sim-tet-${i}`);
    if (!q) return;

    const elapsed = n.timerRunning
      ? Math.round(performance.now() - n.timerStart)
      : 0;
    const pct = n.preset > 0 ? Math.min(100, elapsed / n.preset * 100) : 0;

    q.textContent   = 'Q=' + (n.state ? '1' : '0');
    q.style.color   = n.state ? 'var(--green)' : 'var(--text-dim)';
    if (bar) bar.style.width = pct + '%';
    if (et)  et.textContent  = elapsed + 'ms/' + n.preset + 'ms';
  });
}

// ── Counters dinámicos ───────────────────────────────────────
function _refreshCounters() {
  const CTR_NAMES  = ['ctu', 'ctd'];
  const ctrNodes   = SimState.nodes.filter(n => CTR_NAMES.includes(n.name));
  const wrap  = document.getElementById('sim-counters-wrap');
  const body  = document.getElementById('sim-counters-body');
  if (!wrap || !body) return;

  wrap.style.display = ctrNodes.length ? '' : 'none';
  if (!ctrNodes.length) return;

  if (body.dataset.count !== String(ctrNodes.length)) {
    body.dataset.count = ctrNodes.length;
    body.innerHTML = ctrNodes.map((n, i) => `
      <div class="sim-timer-row">
        <span class="sim-timer-name">${n.name.toUpperCase()}[${i}]</span>
        <span class="sim-timer-q" id="sim-cq-${i}">Q=0</span>
        <div class="sim-timer-bar-bg">
          <div class="sim-timer-bar-fill" id="sim-cb-${i}" style="background:var(--accent2)"></div>
        </div>
        <span class="sim-timer-et" id="sim-cet-${i}">0/0</span>
      </div>`).join('');
  }

  ctrNodes.forEach((n, i) => {
    const q   = document.getElementById(`sim-cq-${i}`);
    const bar = document.getElementById(`sim-cb-${i}`);
    const et  = document.getElementById(`sim-cet-${i}`);
    if (!q) return;

    const cv  = n.intValue ?? 0;
    const pv  = n.value    ?? 0;
    const pct = pv > 0 ? Math.min(100, cv / pv * 100) : 0;

    q.textContent  = 'Q=' + (n.state ? '1' : '0');
    q.style.color  = n.state ? 'var(--green)' : 'var(--text-dim)';
    if (bar) bar.style.width = pct + '%';
    if (et)  et.textContent  = 'CV:' + cv + ' PV:' + pv;
  });
}

// =============================================================
// IO interaction handlers — escriben en SimState directamente
// =============================================================

// Toggle permanente (click)
function simToggleInput(n) {
  SimState.inputs[n] = !SimState.inputs[n];
  simPanelRefresh();
}

// Momentáneo: press/release (mousedown/mouseup)
let _pressTimers = {};
function simPressInput(n, pressed) {
  // Si hay un click pendiente (toggle), lo cancelamos en press
  // Para botón momentáneo: sólo actúa si se mantiene > 80ms
  if (pressed) {
    _pressTimers[n] = setTimeout(() => {
      // Activación momentánea
      SimState.inputs[n] = true;
      simPanelRefresh();
      _pressTimers[n] = null;
    }, 80);
  } else {
    if (_pressTimers[n]) {
      // Fue un click rápido → toggle
      clearTimeout(_pressTimers[n]);
      _pressTimers[n] = null;
      // toggle lo maneja onclick, no hacer nada aquí
    } else {
      // Fue un press largo → soltar
      SimState.inputs[n] = false;
      simPanelRefresh();
    }
  }
}

function simSetAnalog(n, val) {
  SimState.analog[n] = val;
  simPanelRefresh();
}

// =============================================================
// Drag & drop del panel
// =============================================================
function _makeSimPanelDraggable() {
  const panel  = document.getElementById('sim-panel');
  const handle = document.getElementById('sim-drag-handle');
  if (!panel || !handle) return;

  let dragging = false, ox = 0, oy = 0;

  handle.addEventListener('mousedown', e => {
    if (e.target.id === 'sim-collapse-btn') return;
    dragging = true;
    ox = e.clientX - panel.offsetLeft;
    oy = e.clientY - panel.offsetTop;
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top  = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

// =============================================================
// Colapsar / expandir
// =============================================================
function _makeSimPanelCollapsible() {
  const btn  = document.getElementById('sim-collapse-btn');
  const body = document.getElementById('sim-panel-body');
  if (!btn || !body) return;
  let collapsed = false;
  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    btn.textContent    = collapsed ? '▼' : '▲';
  });
}

// =============================================================
// Estilos — inyectados una sola vez, usan vars de style.css
// =============================================================
function _injectSimStyles() {
  if (document.getElementById('sim-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'sim-panel-styles';
  style.textContent = `
    @keyframes sim-dot-pulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:.5; transform:scale(1.4); }
    }

    #sim-panel {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9999;
      width: 230px;
      font-family: var(--font-mono, 'Share Tech Mono', monospace);
      font-size: 10px;
      user-select: none;
    }
    .sim-panel-inner {
      background: var(--panel, #141920);
      border: 1px solid var(--accent, #f5a623);
      border-radius: 5px;
      padding: 10px;
      box-shadow: 0 6px 32px rgba(0,0,0,.7), 0 0 24px rgba(245,166,35,.08);
    }

    /* Header */
    .sim-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-head, 'Rajdhani', sans-serif);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 3px;
      color: var(--accent, #f5a623);
      text-transform: uppercase;
      margin-bottom: 8px;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--border2, #263445);
      cursor: move;
    }
    .sim-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent, #f5a623);
      box-shadow: 0 0 6px var(--accent, #f5a623);
      flex-shrink: 0;
      transition: background .2s, box-shadow .2s;
    }
    .sim-mode-tag {
      margin-left: auto;
      font-size: 9px;
      letter-spacing: 2px;
    }
    .sim-collapse-btn {
      background: none;
      border: none;
      color: var(--text-dim, #4a6070);
      cursor: pointer;
      font-size: 9px;
      padding: 0 2px;
      line-height: 1;
    }
    .sim-collapse-btn:hover { color: var(--accent, #f5a623); }

    /* Sub-titles */
    .sim-sub-title {
      font-size: 8px;
      letter-spacing: 3px;
      color: var(--text-dim, #4a6070);
      text-transform: uppercase;
      margin: 6px 0 4px;
    }

    /* Hint */
    .sim-hint {
      font-size: 8px;
      color: var(--text-dim, #4a6070);
      margin-top: 2px;
      text-align: center;
      opacity: .7;
    }

    /* IO rows */
    .sim-io-row { display: flex; gap: 5px; }

    /* Input buttons */
    .sim-input-btn {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 7px;
      border: 1px solid var(--border2, #263445);
      border-radius: 3px;
      background: var(--bg2, #0f1318);
      color: var(--text-dim, #4a6070);
      cursor: pointer;
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      transition: all .1s;
    }
    .sim-input-btn.on {
      border-color: var(--green, #00e676);
      color: var(--green, #00e676);
      background: rgba(0,230,118,.1);
      box-shadow: 0 0 8px rgba(0,230,118,.2);
    }
    .sim-input-btn:hover { filter: brightness(1.2); }
    .sim-input-btn:active { filter: brightness(1.4); }

    .sim-tag {
      font-size: 7px;
      letter-spacing: .5px;
      color: var(--text-dim, #4a6070);
      opacity: .7;
      margin-left: auto;
    }

    /* LEDs */
    .sim-led {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--border2, #263445);
      flex-shrink: 0;
      transition: all .1s;
    }
    .sim-led.on {
      background: var(--green, #00e676);
      box-shadow: 0 0 6px var(--green, #00e676);
    }

    /* Analog */
    .sim-analog-row { margin-bottom: 4px; }
    .sim-analog-header {
      display: flex;
      justify-content: space-between;
      color: var(--text-mid, #7a9ab0);
      margin-bottom: 3px;
    }
    .sim-scale-marks {
      display: flex;
      justify-content: space-between;
      font-size: 7px;
      color: var(--text-dim, #4a6070);
      margin-top: 2px;
    }
    .sim-slider {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: var(--border2, #263445);
      cursor: pointer;
      outline: none;
    }
    .sim-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px; height: 12px;
      border-radius: 50%;
      background: var(--accent2, #3ab4f2);
      box-shadow: 0 0 5px var(--accent2, #3ab4f2);
      cursor: pointer;
    }

    /* Output cells */
    .sim-out-cell {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 5px 3px;
      background: var(--bg2, #0f1318);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 3px;
      color: var(--text-dim, #4a6070);
      font-size: 9px;
    }
    .sim-out-led {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: var(--border2, #263445);
      border: 1px solid rgba(255,255,255,.06);
      transition: all .1s;
    }
    .sim-out-led.on {
      background: var(--accent, #f5a623);
      box-shadow: 0 0 8px var(--accent, #f5a623);
      border-color: rgba(245,166,35,.4);
    }

    /* PWM */
    .sim-pwm-row {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 4px;
    }
    .sim-pwm-lbl { width: 30px; color: var(--text-dim, #4a6070); }
    .sim-pwm-track {
      flex: 1;
      height: 5px;
      background: var(--bg2, #0f1318);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 3px;
      overflow: hidden;
    }
    .sim-pwm-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #9b59b6, var(--accent2, #3ab4f2));
      border-radius: 3px;
      transition: width .12s;
    }
    .sim-pwm-val { width: 28px; text-align: right; color: var(--text-dim, #4a6070); }

    /* Timers / Counters */
    .sim-timer-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 4px;
    }
    .sim-timer-name {
      width: 52px;
      color: var(--text-mid, #7a9ab0);
      font-size: 9px;
      flex-shrink: 0;
    }
    .sim-timer-q {
      width: 26px;
      font-size: 9px;
      flex-shrink: 0;
    }
    .sim-timer-bar-bg {
      flex: 1;
      height: 4px;
      background: var(--bg2, #0f1318);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 2px;
      overflow: hidden;
    }
    .sim-timer-bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent2, #3ab4f2), var(--green, #00e676));
      transition: width .1s;
    }
    .sim-timer-et {
      font-size: 8px;
      color: var(--text-dim, #4a6070);
      width: 68px;
      text-align: right;
      flex-shrink: 0;
    }

    /* Stats footer */
    .sim-stats {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--border2, #263445);
      color: var(--text-dim, #4a6070);
      font-size: 8px;
    }
    .sim-stats b { color: var(--text-mid, #7a9ab0); }

    /* Banner (ribbon en topbar) */
    #sim-banner {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      background: rgba(245,166,35,.12);
      border: 1px solid rgba(245,166,35,.3);
      border-radius: 3px;
      font-family: var(--font-mono, monospace);
      font-size: 9px;
      color: var(--accent, #f5a623);
      letter-spacing: 1px;
    }
    #sim-banner::before {
      content: '⚡';
      font-size: 10px;
    }
  `;
  document.head.appendChild(style);
}

// =============================================================
// RS485 — funciones del panel de módulos
// mirrors: modbusRegisterSlave, ModbusSlave, rdi/rdo/rai UI
// =============================================================

function simModuleAddPrompt() {
  var form = document.getElementById('sim-rs485-form');
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
}

function simModuleAddConfirm() {
  var typeEl = document.getElementById('sim-rs485-type');
  var addrEl = document.getElementById('sim-rs485-addr');
  var typeKey = typeEl ? typeEl.value : '';
  var addr = addrEl ? parseInt(addrEl.value, 10) : NaN;
  if (!typeKey || isNaN(addr) || addr < 1 || addr > 247) return;
  if (typeof simRegisterModule === 'function') {
    simRegisterModule(addr, typeKey);
    simModuleAddCancel();
    simPanelRefresh();
  }
}

function simModuleAddCancel() {
  var form = document.getElementById('sim-rs485-form');
  if (form) form.style.display = 'none';
}

// Toggle a remote digital input (rdi[idx]).
// Immediately propagates to mem.X[8+idx] so the next scan sees it.
// mirrors: rdi[] -> X[8+] in readInputs() / simReadRemoteInputs()
function simToggleRDI(rdiIdx) {
  if (!SimState.rdi) return;
  SimState.rdi[rdiIdx] = !SimState.rdi[rdiIdx];
  if (SimState.mem && SimState.mem.X) {
    SimState.mem.X[8 + rdiIdx] = SimState.rdi[rdiIdx];
  }
  simPanelRefresh();
}

// Set a remote analog input value (rai[idx], 0-4095).
// Immediately propagates to mem.A[4+idx].
// mirrors: rai[] -> A[4+] in readInputs() / simReadRemoteInputs()
function simSetRAI(raiIdx, val) {
  if (!SimState.rai) return;
  SimState.rai[raiIdx] = parseInt(val, 10) || 0;
  if (SimState.mem && SimState.mem.A) {
    SimState.mem.A[4 + raiIdx] = SimState.rai[raiIdx];
  }
  var el = document.getElementById('sim-rai-val-' + raiIdx);
  if (el) el.textContent = SimState.rai[raiIdx];
}

function simRemoveModule(address) {
  if (typeof simUnregisterModule === 'function') {
    simUnregisterModule(address);
    simPanelRefresh();
  }
}

// Refresh the RS485 modules section.
// Reads rdi[], rdo[], rai[] from SimState directly — no fetch needed.
function _refreshRS485() {
  var body = document.getElementById('sim-rs485-body');
  if (!body) return;
  var slaves = SimState.mbSlaves || [];

  if (slaves.length === 0) {
    body.innerHTML = '<div class="sim-rs485-empty">Sin modulos. Pulsa + para agregar.</div>';
    return;
  }

  var html = '';
  for (var si = 0; si < slaves.length; si++) {
    var s = slaves[si];
    html += '<div class="sim-rs485-module">';

    // Header
    html += '<div class="sim-rs485-header">';
    html += '<span class="sim-rs485-online" style="color:var(--green,#00e676);font-size:8px;">&#9679;</span>';
    html += '<span class="sim-rs485-lbl">' + s.label + '</span>';
    html += '<button class="sim-rs485-del" onclick="simRemoveModule(' + s.address + ')" title="Quitar">x</button>';
    html += '</div>';

    // DI — toggleable (maps to X[8+rdiOff+i])
    if (s.numDI > 0) {
      html += '<div class="sim-rs485-io-label">DI &rarr; X[' + (8 + s.rdiOff) + '+]</div>';
      html += '<div class="sim-rs485-io-row">';
      for (var i = 0; i < s.numDI; i++) {
        var idx = s.rdiOff + i;
        var on  = (SimState.rdi && SimState.rdi[idx]) ? true : false;
        html += '<button class="sim-rs485-di' + (on ? ' on' : '') + '"'
             + ' onclick="simToggleRDI(' + idx + ')"'
             + ' title="rdi[' + idx + '] X[' + (8 + idx) + ']">DI' + i + '</button>';
      }
      html += '</div>';
    }

    // AI — sliders (maps to A[4+raiOff+i])
    if (s.numAI > 0) {
      html += '<div class="sim-rs485-io-label">AI &rarr; A[' + (4 + s.raiOff) + '+]</div>';
      for (var i = 0; i < s.numAI; i++) {
        var idx = s.raiOff + i;
        var val = (SimState.rai && SimState.rai[idx]) || 0;
        html += '<div class="sim-analog-row">';
        html += '<div class="sim-analog-header">'
             + '<span>AI' + i + '</span>'
             + '<span id="sim-rai-val-' + idx + '">' + val + '</span>'
             + '</div>';
        html += '<input type="range" min="0" max="4095" value="' + val + '"'
             + ' class="sim-slider" oninput="simSetRAI(' + idx + ', this.value)">';
        html += '</div>';
      }
    }

    // DO — read-only (reflects rdo[], driven by Y[8+rdoOff+i])
    if (s.numDO > 0) {
      html += '<div class="sim-rs485-io-label">DO &larr; Y[' + (8 + s.rdoOff) + '+]</div>';
      html += '<div class="sim-rs485-io-row">';
      for (var i = 0; i < s.numDO; i++) {
        var idx = s.rdoOff + i;
        var on  = (SimState.rdo && SimState.rdo[idx]) ? true : false;
        html += '<span class="sim-rs485-do' + (on ? ' on' : '') + '"'
             + ' title="rdo[' + idx + '] Y[' + (8 + idx) + ']">DO' + i + '</span>';
      }
      html += '</div>';
    }

    html += '</div>'; // .sim-rs485-module
  }
  body.innerHTML = html;
}

function _injectRS485Styles() {
  if (document.getElementById('sim-rs485-styles')) return;
  var style = document.createElement('style');
  style.id = 'sim-rs485-styles';
  style.textContent = [
    '.sim-rs485-add-btn{background:none;border:1px solid var(--border2,#263445);color:var(--accent2,#3ab4f2);cursor:pointer;width:16px;height:16px;border-radius:3px;font-size:12px;line-height:1;padding:0;}',
    '.sim-rs485-add-btn:hover{border-color:var(--accent2,#3ab4f2);}',
    '.sim-rs485-module{background:var(--bg2,#0f1318);border:1px solid var(--border,#1e2a38);border-radius:3px;padding:6px;margin-bottom:5px;}',
    '.sim-rs485-header{display:flex;align-items:center;gap:5px;margin-bottom:4px;}',
    '.sim-rs485-lbl{flex:1;font-size:9px;color:var(--text-mid,#7a9ab0);font-weight:600;letter-spacing:1px;}',
    '.sim-rs485-del{background:none;border:none;color:var(--text-dim,#4a6070);cursor:pointer;font-size:9px;padding:0 2px;}',
    '.sim-rs485-del:hover{color:var(--red,#ff3d5a);}',
    '.sim-rs485-io-label{font-size:7px;color:var(--text-dim,#4a6070);letter-spacing:1px;margin-bottom:2px;}',
    '.sim-rs485-io-row{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px;}',
    '.sim-rs485-di{padding:2px 4px;border:1px solid var(--border2,#263445);border-radius:2px;background:var(--bg2,#0f1318);color:var(--text-dim,#4a6070);cursor:pointer;font-family:var(--font-mono,monospace);font-size:8px;transition:all .1s;}',
    '.sim-rs485-di.on{border-color:var(--green,#00e676);color:var(--green,#00e676);background:rgba(0,230,118,.1);}',
    '.sim-rs485-di:active{filter:brightness(1.4);}',
    '.sim-rs485-do{padding:2px 4px;border:1px solid var(--border,#1e2a38);border-radius:2px;background:var(--bg2,#0f1318);color:var(--text-dim,#4a6070);font-family:var(--font-mono,monospace);font-size:8px;}',
    '.sim-rs485-do.on{border-color:var(--accent,#f5a623);color:var(--accent,#f5a623);background:rgba(245,166,35,.1);box-shadow:0 0 5px rgba(245,166,35,.3);}',
    '.sim-rs485-empty{font-size:9px;color:var(--text-dim,#4a6070);text-align:center;padding:6px 0;}',
    '.sim-rs485-row{display:flex;gap:4px;align-items:center;margin-bottom:4px;}',
    '.sim-rs485-select{flex:1;background:var(--bg2,#0f1318);border:1px solid var(--border2,#263445);color:var(--text,#c8d6e5);font-family:var(--font-mono,monospace);font-size:8px;padding:2px;border-radius:2px;outline:none;}',
    '.sim-rs485-input{width:38px;background:var(--bg2,#0f1318);border:1px solid var(--border2,#263445);color:var(--text,#c8d6e5);font-family:var(--font-mono,monospace);font-size:8px;padding:2px 3px;border-radius:2px;outline:none;}',
    '.sim-rs485-ok-btn,.sim-rs485-cancel-btn{background:none;border:1px solid var(--border2,#263445);color:var(--text-dim,#4a6070);cursor:pointer;font-size:10px;padding:1px 5px;border-radius:2px;}',
    '.sim-rs485-ok-btn:hover{color:var(--green,#00e676);border-color:var(--green,#00e676);}',
    '.sim-rs485-cancel-btn:hover{color:var(--red,#ff3d5a);border-color:var(--red,#ff3d5a);}',
  ].join('');
  document.head.appendChild(style);
}


// Boot — inyectar panel y arrancar refresh a 10Hz
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  simPanelInject();
  setInterval(simPanelRefresh, 100);
});
