// =============================================================
// modbus_panel.js — PLC-CORE-MDE Cloud Simulator
// Injects the Modbus Simulator Panel into monitor.html
//
// Features:
//   - "Add Module" form: Address + Type selector
//   - Module cards with online status, IO tags
//   - Remove module button per card
//   - Remote IO live table (RDI, RDO, RAI values)
//   - Real-time refresh at 2Hz
// =============================================================

'use strict';

function modbusPanelInject() {
  const panel = document.createElement('div');
  panel.id = 'modbus-sim-panel';
  panel.innerHTML = `
    <div class="mbsim-inner">

      <div class="mbsim-title">
        <span class="mbsim-dot"></span>
        MODBUS SIMULATOR
        <span class="mbsim-badge" id="mbsim-badge">0 SLAVES</span>
      </div>

      <!-- Add module form -->
      <div class="mbsim-add-row">
        <label class="mbsim-lbl">ADD MODULE</label>
        <div class="mbsim-add-form">
          <input type="number" id="mbsim-addr" min="1" max="247" value="1"
                 class="mbsim-input" placeholder="Addr">
          <select id="mbsim-type" class="mbsim-select">
            <option value="1">WS-RELAY8</option>
            <option value="2">WS-RELAY16</option>
            <option value="3">WS-IO8</option>
            <option value="4">WS-AI8</option>
            <option value="5">WS-AO8</option>
            <option value="16">MDE-DI16</option>
            <option value="17">MDE-DO16</option>
            <option value="18">MDE-AI8</option>
            <option value="19">MDE-AO8</option>
            <option value="48">MDE-MIXED</option>
          </select>
          <button class="mbsim-btn add-btn" onclick="modbusPanelAdd()">+ ADD</button>
        </div>
      </div>

      <!-- Slave cards -->
      <div id="mbsim-cards" class="mbsim-cards">
        <div class="mbsim-empty">No modules. Press SCAN RS485 or add manually.</div>
      </div>

      <!-- Remote IO snapshot -->
      <div class="mbsim-lbl" style="margin-top:8px;">REMOTE IO SNAPSHOT</div>
      <div id="mbsim-io-snap" class="mbsim-io-snap">—</div>

    </div>
  `;

  document.body.appendChild(panel);
  _injectModbusStyles();
}

// =============================================================
// modbusPanelRefresh — render slave cards + IO snapshot
// =============================================================
function modbusPanelRefresh() {
  const badge = document.getElementById('mbsim-badge');
  const cards = document.getElementById('mbsim-cards');
  const snap  = document.getElementById('mbsim-io-snap');
  if (!cards) return;

  // Badge
  if (badge) badge.textContent = SimState.mbSlaveCount + ' SLAVE' + (SimState.mbSlaveCount !== 1 ? 'S' : '');

  // Slave cards
  if (SimState.mbSlaveCount === 0) {
    cards.innerHTML = '<div class="mbsim-empty">No modules. Press SCAN RS485 or add manually.</div>';
  } else {
    cards.innerHTML = SimState.mbSlaves.map(s => {
      const ioTags = [
        s.numDI > 0 ? `<span class="mb-tag di">DI${s.numDI}</span>` : '',
        s.numDO > 0 ? `<span class="mb-tag do">DO${s.numDO}</span>` : '',
        s.numAI > 0 ? `<span class="mb-tag ai">AI${s.numAI}</span>` : '',
        s.numAO > 0 ? `<span class="mb-tag ao">AO${s.numAO}</span>` : '',
      ].filter(Boolean).join('');
      return `
        <div class="mbsim-card">
          <div class="mbsim-card-dot ${s.online ? 'online' : 'offline'}"></div>
          <div class="mbsim-card-body">
            <div class="mbsim-card-label">${s.label}</div>
            <div class="mbsim-card-io">${ioTags}</div>
            <div class="mbsim-card-stats">polls:${s.pollCount} err:${s.errorCount}</div>
          </div>
          <button class="mbsim-rm-btn" onclick="modbusPanelRemove(${s.address})" title="Remove">✕</button>
        </div>
      `;
    }).join('');
  }

  // IO Snapshot — first 8 of each type
  let snapHtml = '<table class="mbsim-io-tbl">';
  snapHtml += '<tr><th>RDI</th>';
  for (let i = 0; i < 8; i++) {
    const v = SimState.rdi[i];
    snapHtml += `<td class="${v ? 'mb-on' : 'mb-off'}">${v ? '1' : '0'}</td>`;
  }
  snapHtml += '</tr><tr><th>RAI</th>';
  for (let i = 0; i < 8; i++) {
    snapHtml += `<td class="mb-ai">${SimState.rai[i] || 0}</td>`;
  }
  snapHtml += '</tr><tr><th>RDO</th>';
  for (let i = 0; i < 8; i++) {
    const v = SimState.rdo[i];
    snapHtml += `<td class="${v ? 'mb-on' : 'mb-off'}">${v ? '1' : '0'}</td>`;
  }
  snapHtml += '</tr></table>';
  if (snap) snap.innerHTML = snapHtml;
}

// =============================================================
// Add / Remove handlers
// =============================================================
function modbusPanelAdd() {
  const addrEl = document.getElementById('mbsim-addr');
  const typeEl = document.getElementById('mbsim-type');
  if (!addrEl || !typeEl) return;
  const addr = parseInt(addrEl.value);
  const type = parseInt(typeEl.value);
  if (isNaN(addr) || addr < 1 || addr > 247) {
    alert('Invalid address (1-247)');
    return;
  }
  const ok = modbusAddSlave(addr, type);
  if (!ok) alert('Slave at address ' + addr + ' already exists.');
  else {
    addrEl.value = addr + 1;
    modbusPanelRefresh();
  }
}

function modbusPanelRemove(addr) {
  modbusRemoveSlave(addr);
  modbusPanelRefresh();
}

// =============================================================
// Styles
// =============================================================
function _injectModbusStyles() {
  if (document.getElementById('mbsim-styles')) return;
  const style = document.createElement('style');
  style.id = 'mbsim-styles';
  style.textContent = `
    #modbus-sim-panel {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 9000;
      width: 260px;
      font-family: var(--font-mono, monospace);
      font-size: 10px;
    }
    .mbsim-inner {
      background: var(--panel, #151e2b);
      border: 1px solid var(--accent2, #3ab4f2);
      border-radius: 5px;
      padding: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 0 20px rgba(58,180,242,0.08);
    }
    .mbsim-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-head, monospace);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 3px;
      color: var(--accent2, #3ab4f2);
      text-transform: uppercase;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border2, #2a3a4a);
    }
    .mbsim-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent2, #3ab4f2);
      box-shadow: 0 0 8px var(--accent2, #3ab4f2);
      flex-shrink: 0;
    }
    .mbsim-badge {
      margin-left: auto;
      font-size: 9px;
      letter-spacing: 1px;
      color: var(--text-dim, #4a6080);
    }
    .mbsim-lbl {
      font-size: 9px;
      letter-spacing: 3px;
      color: var(--text-dim, #4a6080);
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .mbsim-add-row { margin-bottom: 8px; }
    .mbsim-add-form {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }
    .mbsim-input {
      width: 48px;
      padding: 4px 6px;
      background: var(--bg2, #0d1520);
      border: 1px solid var(--border2, #2a3a4a);
      border-radius: 3px;
      color: var(--text, #c8d8e8);
      font-family: var(--font-mono, monospace);
      font-size: 10px;
    }
    .mbsim-select {
      flex: 1;
      padding: 4px 4px;
      background: var(--bg2, #0d1520);
      border: 1px solid var(--border2, #2a3a4a);
      border-radius: 3px;
      color: var(--text, #c8d8e8);
      font-family: var(--font-mono, monospace);
      font-size: 10px;
    }
    .mbsim-btn {
      padding: 4px 8px;
      border: 1px solid;
      border-radius: 3px;
      cursor: pointer;
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      transition: all 0.1s;
    }
    .add-btn {
      border-color: var(--accent2, #3ab4f2);
      color: var(--accent2, #3ab4f2);
      background: rgba(58,180,242,0.08);
    }
    .add-btn:hover { background: rgba(58,180,242,0.2); }
    .mbsim-cards { max-height: 180px; overflow-y: auto; margin-bottom: 4px; }
    .mbsim-empty { color: var(--text-dim, #4a6080); padding: 8px 0; font-size: 9px; }
    .mbsim-card {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--bg2, #0d1520);
      border: 1px solid var(--border, #1e2a38);
      border-radius: 3px;
      margin-bottom: 4px;
    }
    .mbsim-card-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .mbsim-card-dot.online  { background: var(--green, #00e676); box-shadow: 0 0 6px var(--green, #00e676); }
    .mbsim-card-dot.offline { background: var(--red,   #ff3d5a); }
    .mbsim-card-body { flex: 1; }
    .mbsim-card-label { color: var(--text-mid, #a0b8d0); font-weight: 600; margin-bottom: 2px; }
    .mbsim-card-io { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 2px; }
    .mbsim-card-stats { color: var(--text-dim, #4a6080); font-size: 9px; }
    .mb-tag {
      font-size: 8px; padding: 1px 4px; border-radius: 2px;
    }
    .mb-tag.di { background: rgba(0,230,118,0.1);  color: var(--green, #00e676); }
    .mb-tag.do { background: rgba(245,166,35,0.1); color: var(--accent, #f5a623); }
    .mb-tag.ai { background: rgba(200,130,224,0.1); color: #c882e0; }
    .mb-tag.ao { background: rgba(255,215,64,0.1); color: var(--yellow, #ffd740); }
    .mbsim-rm-btn {
      background: none;
      border: none;
      color: var(--text-dim, #4a6080);
      cursor: pointer;
      padding: 2px 4px;
      font-size: 11px;
      border-radius: 2px;
      transition: color 0.1s;
    }
    .mbsim-rm-btn:hover { color: var(--red, #ff3d5a); }
    /* IO snapshot table */
    .mbsim-io-snap { margin-top: 4px; }
    .mbsim-io-tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
    }
    .mbsim-io-tbl th {
      text-align: left;
      padding: 2px 4px;
      color: var(--text-dim, #4a6080);
      letter-spacing: 1px;
      font-size: 8px;
      font-weight: 700;
    }
    .mbsim-io-tbl td {
      padding: 2px 3px;
      text-align: center;
      font-size: 9px;
      border-radius: 2px;
    }
    .mb-on  { color: var(--green, #00e676); font-weight: 700; }
    .mb-off { color: var(--border2, #2a3a4a); }
    .mb-ai  { color: #c882e0; }
  `;
  document.head.appendChild(style);
}

// =============================================================
// Boot
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  modbusPanelInject();
  makeModbusPanelDraggable();
  setInterval(modbusPanelRefresh, 500);
});
// =============================================================
// Make Modbus panel draggable
// =============================================================

function makeModbusPanelDraggable() {
  const panel = document.getElementById("modbus-sim-panel");
  if (!panel) return;

  let isDown = false;
  let offsetX = 0;
  let offsetY = 0;

  panel.addEventListener("mousedown", (e) => {
    isDown = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;

    panel.style.left = panel.offsetLeft + "px";
    panel.style.top = panel.offsetTop + "px";
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
