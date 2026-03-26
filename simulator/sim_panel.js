// =============================================================
// sim_panel.js — PLC-CORE-MDE Cloud Simulator
// Injects the Simulator IO Panel into monitor.html
//
// Panel sections:
//   INPUTS  — toggle buttons for DI0, DI1
//   ANALOG  — slider 0-4095 for AI0
//   OUTPUTS — LEDs for DO0-DO3 + PWM bars
// =============================================================

'use strict';

// =============================================================
// Inject simulator panel HTML into the DOM
// Panel is appended after the existing monitor layout
// =============================================================
function simPanelInject() {
  // Create the floating sim panel container
  const panel = document.createElement('div');
  panel.id = 'sim-panel';
  panel.innerHTML = `
    <div class="sim-panel-inner">

      <div class="sim-section-title">
        <span class="sim-dot"></span>
        SIMULATOR
        <span class="sim-mode-tag" id="sim-mode-tag">STOP</span>
      </div>

      <!-- INPUTS -->
      <div class="sim-sub-title">INPUTS</div>
      <div class="sim-io-row" id="sim-inputs-row">
        <button class="sim-input-btn off" id="sim-in-0" onclick="simToggleInput(0)">
          <span class="sim-led" id="sim-led-in0"></span>
          <span>DI0</span>
        </button>
        <button class="sim-input-btn off" id="sim-in-1" onclick="simToggleInput(1)">
          <span class="sim-led" id="sim-led-in1"></span>
          <span>DI1</span>
        </button>
      </div>

      <!-- ANALOG -->
      <div class="sim-sub-title">ANALOG INPUT</div>
      <div class="sim-analog-row">
        <div class="sim-analog-label">
          <span>AI0</span>
          <span id="sim-ai-val">0</span>
        </div>
        <input type="range" min="0" max="4095" value="0" id="sim-ai-0"
               class="sim-slider"
               oninput="simSetAnalog(0, parseInt(this.value))">
        <div class="sim-analog-label small">
          <span>0</span><span>2048</span><span>4095</span>
        </div>
      </div>

      <!-- OUTPUTS -->
      <div class="sim-sub-title">OUTPUTS</div>
      <div class="sim-io-row" id="sim-outputs-row">
        <div class="sim-out-cell" id="sim-out-0">
          <span class="sim-out-led off" id="sim-led-out0"></span>
          <span>DO0</span>
        </div>
        <div class="sim-out-cell" id="sim-out-1">
          <span class="sim-out-led off" id="sim-led-out1"></span>
          <span>DO1</span>
        </div>
        <div class="sim-out-cell" id="sim-out-2">
          <span class="sim-out-led off" id="sim-led-out2"></span>
          <span>DO2</span>
        </div>
        <div class="sim-out-cell" id="sim-out-3">
          <span class="sim-out-led off" id="sim-led-out3"></span>
          <span>DO3</span>
        </div>
      </div>

      <!-- PWM bars -->
      <div class="sim-sub-title">PWM</div>
      <div id="sim-pwm-bars">
        <div class="sim-pwm-row">
          <span class="sim-pwm-lbl">OUT0</span>
          <div class="sim-pwm-track"><div class="sim-pwm-fill" id="sim-pwm-0"></div></div>
          <span class="sim-pwm-val" id="sim-pwm-val-0">0</span>
        </div>
        <div class="sim-pwm-row">
          <span class="sim-pwm-lbl">OUT1</span>
          <div class="sim-pwm-track"><div class="sim-pwm-fill" id="sim-pwm-1"></div></div>
          <span class="sim-pwm-val" id="sim-pwm-val-1">0</span>
        </div>
        <div class="sim-pwm-row">
          <span class="sim-pwm-lbl">OUT2</span>
          <div class="sim-pwm-track"><div class="sim-pwm-fill" id="sim-pwm-2"></div></div>
          <span class="sim-pwm-val" id="sim-pwm-val-2">0</span>
        </div>
        <div class="sim-pwm-row">
          <span class="sim-pwm-lbl">OUT3</span>
          <div class="sim-pwm-track"><div class="sim-pwm-fill" id="sim-pwm-3"></div></div>
          <span class="sim-pwm-val" id="sim-pwm-val-3">0</span>
        </div>
      </div>

      <!-- Scan stats -->
      <div class="sim-stats">
        <span>SCANS: <b id="sim-scan-cnt">0</b></span>
        <span>MODE: <b id="sim-stat-mode" style="color:var(--accent)">STOP</b></span>
      </div>

    </div>
  `;

  // Insert before closing body
  document.body.appendChild(panel);

  // Inject styles
  _injectSimStyles();
}

// =============================================================
// simPanelRefresh — called by setInterval or scan events
// =============================================================
function simPanelRefresh() {
  // Update mode tag
  const modeTag  = document.getElementById('sim-mode-tag');
  const statMode = document.getElementById('sim-stat-mode');
  if (modeTag) {
    modeTag.textContent = SimState.plcMode;
    modeTag.style.color = SimState.plcMode === 'RUN' ? 'var(--green)' : 'var(--accent)';
  }
  if (statMode) {
    statMode.textContent = SimState.plcMode;
    statMode.style.color = SimState.plcMode === 'RUN' ? 'var(--green)' : 'var(--accent)';
  }

  // Update input buttons
  SimState.inputs.forEach((val, i) => {
    const btn = document.getElementById(`sim-in-${i}`);
    const led = document.getElementById(`sim-led-in${i}`);
    if (btn) { btn.className = 'sim-input-btn ' + (val ? 'on' : 'off'); }
    if (led) { led.className = 'sim-led ' + (val ? 'on' : ''); }
  });

  // Update analog display
  const aiVal = document.getElementById('sim-ai-val');
  if (aiVal) aiVal.textContent = SimState.analog[0] || 0;

  // Update output LEDs
  SimState.outputs.forEach((val, i) => {
    const led = document.getElementById(`sim-led-out${i}`);
    if (led) led.className = 'sim-out-led ' + (val ? 'on' : 'off');
  });

  // Update PWM bars
  SimState.pwmValues.forEach((val, i) => {
    const fill = document.getElementById(`sim-pwm-${i}`);
    const valEl = document.getElementById(`sim-pwm-val-${i}`);
    if (fill)  fill.style.width  = Math.round(val / 4095 * 100) + '%';
    if (valEl) valEl.textContent = val;
  });

  // Scan counter
  const scanCnt = document.getElementById('sim-scan-cnt');
  if (scanCnt) scanCnt.textContent = SimState.scanCount;
}

// =============================================================
// IO interaction handlers
// =============================================================
function simToggleInput(n) {
  SimState.inputs[n] = !SimState.inputs[n];
  simPanelRefresh();
}

function simSetAnalog(n, val) {
  SimState.analog[n] = val;
  simPanelRefresh();
}

// =============================================================
// Styles — injected once, uses existing CSS vars from style.css
// =============================================================
function _injectSimStyles() {
  if (document.getElementById('sim-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'sim-panel-styles';
  style.textContent = `
    #sim-panel {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9000;
      width: 220px;
      font-family: var(--font-mono, monospace);
      font-size: 10px;
    }
    .sim-panel-inner {
      background: var(--panel, #151e2b);
      border: 1px solid var(--accent, #f5a623);
      border-radius: 5px;
      padding: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 0 20px rgba(245,166,35,0.1);
    }
    .sim-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-head, monospace);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 3px;
      color: var(--accent, #f5a623);
      text-transform: uppercase;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border2, #2a3a4a);
    }
    .sim-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent, #f5a623);
      box-shadow: 0 0 8px var(--accent, #f5a623);
      flex-shrink: 0;
    }
    .sim-mode-tag {
      margin-left: auto;
      font-size: 9px;
      letter-spacing: 2px;
      color: var(--accent, #f5a623);
    }
    .sim-sub-title {
      font-size: 9px;
      letter-spacing: 3px;
      color: var(--text-dim, #4a6080);
      text-transform: uppercase;
      margin: 8px 0 5px;
    }
    .sim-io-row {
      display: flex;
      gap: 6px;
      margin-bottom: 4px;
    }
    /* Input toggle buttons */
    .sim-input-btn {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 8px;
      border: 1px solid var(--border2, #2a3a4a);
      border-radius: 3px;
      background: var(--bg2, #0d1520);
      color: var(--text-dim, #4a6080);
      cursor: pointer;
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      transition: all 0.1s;
      user-select: none;
    }
    .sim-input-btn.on {
      border-color: var(--green, #00e676);
      color: var(--green, #00e676);
      background: rgba(0,230,118,0.1);
      box-shadow: 0 0 8px rgba(0,230,118,0.2);
    }
    .sim-input-btn:hover { filter: brightness(1.2); }
    /* LED dots */
    .sim-led {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--border2, #2a3a4a);
      flex-shrink: 0;
      transition: all 0.1s;
    }
    .sim-led.on {
      background: var(--green, #00e676);
      box-shadow: 0 0 6px var(--green, #00e676);
    }
    /* Analog slider */
    .sim-analog-row { margin-bottom: 4px; }
    .sim-analog-label {
      display: flex;
      justify-content: space-between;
      color: var(--text-mid, #a0b8d0);
      margin-bottom: 3px;
    }
    .sim-analog-label.small {
      font-size: 8px;
      color: var(--text-dim, #4a6080);
      margin-top: 2px;
    }
    .sim-slider {
      width: 100%;
      height: 4px;
      cursor: pointer;
      accent-color: var(--accent2, #3ab4f2);
    }
    /* Output LEDs */
    .sim-out-cell {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 6px 4px;
      background: var(--bg2, #0d1520);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 3px;
      color: var(--text-dim, #4a6080);
      font-size: 9px;
    }
    .sim-out-led {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: var(--border2, #2a3a4a);
      border: 2px solid rgba(255,255,255,0.05);
      transition: all 0.1s;
    }
    .sim-out-led.on {
      background: var(--accent, #f5a623);
      box-shadow: 0 0 8px var(--accent, #f5a623);
      border-color: rgba(245,166,35,0.4);
    }
    /* PWM bars */
    .sim-pwm-row {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 4px;
    }
    .sim-pwm-lbl { width: 32px; color: var(--text-dim, #4a6080); }
    .sim-pwm-track {
      flex: 1;
      height: 5px;
      background: var(--bg2, #0d1520);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 3px;
      overflow: hidden;
    }
    .sim-pwm-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #c882e0, var(--accent2, #3ab4f2));
      border-radius: 3px;
      transition: width 0.15s;
    }
    .sim-pwm-val { width: 32px; text-align:right; color: var(--text-dim, #4a6080); }
    /* Stats row */
    .sim-stats {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--border2, #2a3a4a);
      color: var(--text-dim, #4a6080);
      font-size: 9px;
    }
    .sim-stats b { color: var(--text-mid, #a0b8d0); }
  `;
  document.head.appendChild(style);
}

// =============================================================
// Auto-refresh at 10Hz for real-time feel
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  simPanelInject();
  makeSimPanelDraggable();
  setInterval(simPanelRefresh, 100);
});
// =============================================================
// Make panel draggable
// =============================================================

function makeSimPanelDraggable() {
  const panel = document.getElementById("sim-panel");
  if (!panel) return;

  let isDown = false;
  let offsetX = 0;
  let offsetY = 0;

  panel.addEventListener("mousedown", (e) => {
    isDown = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDown) return;

    panel.style.left = (e.clientX - offsetX) + "px";
    panel.style.top = (e.clientY - offsetY) + "px";
  });

  document.addEventListener("mouseup", () => {
    isDown = false;
  });
}
