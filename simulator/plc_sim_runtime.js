// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// plc_sim_runtime.js — v3 (motor determinista, espejo de plc_runtime.cpp v6)
//
// FUENTE DE VERDAD: plc_runtime.cpp (plcScan / plcBuildExecOrder)
//
// v3: un solo pase por nodo en orden de dependencias (execOrder), entradas
// resueltas por PUERTO, SCALE entero con truncamiento (idéntico al firmware),
// ciclos cortados en el bloque con memoria de menor ID (Tarjan + Kahn).
//
// Porta fielmente:
//   runtimeClear()     → mirrors void runtimeClear()
//   parseProgram(json) → mirrors void parseProgram(String json)
//   plcScan()          → mirrors void plcScan() → plcScanNodes()
//
// CONTRATO DE DISEÑO:
//   - Toda la lógica de scan replica EXACTAMENTE plcScanNodes()
//   - El orden de fases es idéntico (1, 2, 3a, 3b, 3c, 3d, 3e, 4, 5)
//   - El bloque de memory sync al final replica el de plcScanNodes()
//   - performance.now() ≡ millis() del firmware (alta resolución)
//   - NO se inventa comportamiento: si el firmware no lo hace, el sim tampoco
//   - Diferencias con simulador viejo → siempre priorizar firmware
//
// FASE 1 únicamente — sin simulateIR(ir, state, dt) por ahora.
// El motor opera sobre el grafo de nodos (Drawflow JSON), igual
// que plcScanNodes() en EXEC_NODE mode.
// =============================================================

'use strict';

// =============================================================
// Helpers internos — mirrors static helpers de plc_runtime.cpp
// =============================================================

function _getNodeIndexById(id) {
  const nodes = SimState.nodes;
  for (let i = 0; i < SimState.nodeCount; i++) {
    if (nodes[i].id === id) return i;
  }
  return -1;
}

// Fuentes numéricas: AI1 y SCALE propagan intValue (mirrors isNumericSource)
function _isNumericSource(t) { return t === 'analog1' || t === 'scale'; }

// mirrors static int getNodeIntValue(int idx)
function _getNodeIntValue(idx) {
  if (idx < 0) return 0;
  const n = SimState.nodes[idx];
  if (_isNumericSource(n.type)) return n.intValue;
  return n.state ? 1 : 0;
}

// mirrors static bool inState(const PlcNode&, which)
function _inState(n, which) {
  const src = which === 0 ? n.input1 : n.input2;
  return src >= 0 ? SimState.nodes[src].state : false;
}

function _isMemoryType(t) {
  return t === 'ton' || t === 'tof' || t === 'tp' || t === 'blink' ||
         t === 'ctu' || t === 'ctd' || t === 'sr' || t === 'rs' ||
         t === 'r_trig' || t === 'f_trig';
}

// mirrors jsonToInt: entero JSON o string (como guarda Drawflow); otro -> 0
function _jsonToInt(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isInteger(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

// mirrors plcBuildExecOrder() — mismo algoritmo, mismos desempates
function buildExecOrder() {
  const nodes = SimState.nodes, n = SimState.nodeCount;
  SimState.execOrder = [];
  if (n <= 0) return;

  const byId = [];
  for (let i = 0; i < n; i++) byId.push(i);
  byId.sort((x, y) => nodes[x].id - nodes[y].id || x - y);   // estable, como la inserción del firmware

  const pred = (i, k) => (k === 0 ? nodes[i].input1 : nodes[i].input2);
  const edgeOn = [], edgeCut = [];
  for (let i = 0; i < n; i++) {
    edgeOn.push([false, false]); edgeCut.push([false, false]);
    for (let k = 0; k < 2; k++) {
      const p = pred(i, k);
      edgeOn[i][k] = (p >= 0 && p !== i && nodes[p].type !== 'prev');
    }
  }
  const before = new Array(n).fill(null).map(() => new Set());

  for (let guard = 0; guard < n * 2 + 2; guard++) {
    // Tarjan
    const idx = new Array(n).fill(0), low = new Array(n).fill(0);
    const on = new Array(n).fill(false), comp = new Array(n).fill(-1);
    const stack = []; let counter = 0, compCount = 0;
    const visit = (v) => {
      idx[v] = low[v] = ++counter; stack.push(v); on[v] = true;
      for (let w = 0; w < n; w++) {
        for (let k = 0; k < 2; k++) {
          if (!edgeOn[w][k] || edgeCut[w][k]) continue;
          if (pred(w, k) !== v) continue;
          if (idx[w] === 0) { visit(w); if (low[w] < low[v]) low[v] = low[w]; }
          else if (on[w]) { if (idx[w] < low[v]) low[v] = idx[w]; }
        }
      }
      if (low[v] === idx[v]) {
        let w;
        do { w = stack.pop(); on[w] = false; comp[w] = compCount; } while (w !== v);
        compCount++;
      }
    };
    for (let i = 0; i < n; i++) if (idx[i] === 0) visit(i);

    let cutAny = false;
    for (let c = 0; c < compCount; c++) {
      let size = 0;
      for (let i = 0; i < n; i++) if (comp[i] === c) size++;
      if (size < 2) continue;
      let pivot = -1, pivotAny = -1;
      for (let a = 0; a < n; a++) {
        const i = byId[a];
        if (comp[i] !== c) continue;
        if (pivotAny < 0) pivotAny = i;
        if (pivot < 0 && _isMemoryType(nodes[i].type)) pivot = i;
      }
      if (pivot < 0) pivot = pivotAny;
      for (let x = 0; x < n; x++) {
        if (comp[x] !== c) continue;
        for (let k = 0; k < 2; k++) {
          if (!edgeOn[x][k] || edgeCut[x][k]) continue;
          if (pred(x, k) !== pivot) continue;
          edgeCut[x][k] = true;
          before[pivot].add(x);
          cutAny = true;
        }
      }
    }
    if (!cutAny) break;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const done = new Array(n).fill(false);
    const order = [];
    let stuck = false;
    while (order.length < n) {
      let pick = -1;
      for (let a = 0; a < n; a++) {
        const i = byId[a];
        if (done[i]) continue;
        let ok = true;
        if (attempt === 0) for (const x of before[i]) if (!done[x]) { ok = false; break; }
        if (ok) for (let k = 0; k < 2; k++)
          if (edgeOn[i][k] && !edgeCut[i][k] && !done[pred(i, k)]) { ok = false; break; }
        if (ok) { pick = i; break; }
      }
      if (pick < 0) { stuck = true; break; }
      order.push(pick); done[pick] = true;
    }
    if (!stuck) { SimState.execOrder = order; return; }
    if (attempt === 1) {
      console.warn('[PLC] AVISO: orden de ejecución incompleto, se completa por ID');
      for (let a = 0; a < n; a++) { const i = byId[a]; if (!done[i]) { order.push(i); done[i] = true; } }
      SimState.execOrder = order;
    }
  }
}

// mirrors static int getInputPhysIndex(const String& name)
function _getInputPhysIndex(name) {
  if (name === 'input1') return 0;
  if (name === 'input2') return 1;
  return -1;
}

// mirrors static int getOutputPhysIndex(const String& name)
function _getOutputPhysIndex(name) {
  if (name === 'output1') return 0;
  if (name === 'output2') return 1;
  if (name === 'output3') return 2;
  if (name === 'output4') return 3;
  return -1;
}

// mirrors static int getAnalogPhysIndex(const String& name)
function _getAnalogPhysIndex(name) {
  if (name === 'analog1') return 0;
  return -1;
}

// mirrors Arduino constrain(val, mn, mx)
function _constrain(val, mn, mx) {
  return Math.max(mn, Math.min(mx, val));
}

// =============================================================
// _memReset — limpia SimState.mem completamente
// Llamado por runtimeClear() para evitar valores residuales
// de timers/counters entre cargas de programa.
// mirrors: memset(&plcMem, 0, sizeof(PlcMemory)) en memoryInit()
// =============================================================
function _memReset() {
  const m = SimState.mem;
  m.X.fill(false); m.Y.fill(false); m.M.fill(false);
  m.T.fill(false); m.C.fill(false);
  m.R.fill(0);     m.A.fill(0);
  // Reset IO mirrors too — inputs set by user are intentional,
  // but outputs/pwm should be zeroed.
  SimState.outputs.fill(false);
  SimState.pwmValues.fill(0);
  // NOTE: SimState.inputs[] is NOT reset here — the user's toggle
  // state is intentional and should survive a program reload,
  // mirroring the real PLC where physical switches retain their state.
}

// =============================================================
// runtimeClear — mirrors void runtimeClear()
// =============================================================
function runtimeClear() {
  SimState.nodeCount = 0;
  SimState.nodes = [];
  SimState.execOrder = [];
  _memReset();
  // plcMutex: no-op in sim
}

// =============================================================
// parseProgram — mirrors void parseProgram(String json)
//
// PASADA 1: cargar nodos desde JSON (readInt / readULong lambdas)
// PASADA 2: resolver input1/input2 por índice (O(n²))
// PASADA 3: registrar pines PWM
//
// NO se implementa PASADA 4 (order[] / IR topológico) en Fase 1.
// El simulador opera en EXEC_NODE mode.
// =============================================================
function parseProgram(jsonStr) {
  if (!jsonStr || jsonStr.length === 0) {
    runtimeClear();
    console.warn('[PLC] parseProgram: JSON vacío');
    return;
  }

  // Transaccional: si el JSON es inválido se conserva el programa anterior
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[PLC] JSON parse error (programa anterior conservado):', e);
    return;
  }

  // Soportar formato completo y bare data (igual que simulador viejo)
  let data = null;
  if (doc?.drawflow?.Home?.data) {
    data = doc.drawflow.Home.data;
  } else if (doc?.Home?.data) {
    data = doc.Home.data;
  }

  if (!data) {
    console.error('[PLC] parseProgram: no se encontró drawflow.Home.data (programa anterior conservado)');
    return;
  }

  runtimeClear();
  const conns = [];   // por nodo: [{target:id, port:int}]

  // ── PASADA 1: cargar nodos ───────────────────────────────────
  for (const key of Object.keys(data)) {
    if (SimState.nodeCount >= 64 /* MAX_NODES */) {
      console.warn('[PLC] AVISO: el programa tiene más de 64 nodos; se ignoran los restantes');
      break;
    }

    const node = data[key];
    const nd = makePlcNode();

    nd.id   = _jsonToInt(node.id);
    nd.name = (node.name || '').toLowerCase();
    nd.type = nd.name;

    const readInt = (k) => _jsonToInt(node.data?.[k]);
    // Valor por defecto SOLO si falta o está vacío (un 0 explícito es válido)
    const readIntDef = (k, def) => {
      const v = node.data?.[k];
      if (v == null) return def;
      if (typeof v === 'string' && v === '') return def;
      return _jsonToInt(v);
    };
    const readULong = (k) => Math.max(0, readInt(k));

    nd.value  = readInt('value');
    nd.outIdx = readInt('out');
    nd.preset = readULong('time');
    nd.op = (node.data?.op) || '>';
    nd.counterVal = readInt('pv');

    nd.scaleInMin  = readIntDef('inMin', 0);
    nd.scaleInMax  = readIntDef('inMax', 4095);
    nd.scaleOutMin = readIntDef('outMin', 0);
    nd.scaleOutMax = readIntDef('outMax', 100);

    nd.outputs = [];
    nd.outputCount = 0;
    const cl = [];
    if (node.outputs) {
      for (const portKey of Object.keys(node.outputs)) {
        const port = node.outputs[portKey];
        if (port?.connections) {
          for (const conn of port.connections) {
            const targetId = _jsonToInt(conn.node);
            const m = /^input_(\d+)$/.exec(conn.output || '');
            cl.push({ target: targetId, port: m ? parseInt(m[1], 10) - 1 : -1 });
          }
        }
      }
    }
    conns.push(cl);

    SimState.nodes.push(nd);
    SimState.nodeCount++;
  }

  // ── PASADA 2: resolver conexiones por PUERTO ────────────────
  // Drivers en orden de ID ascendente (reparto de respaldo determinista)
  const nodes = SimState.nodes, nc = SimState.nodeCount;
  const byId = [];
  for (let i = 0; i < nc; i++) byId.push(i);
  byId.sort((x, y) => nodes[x].id - nodes[y].id || x - y);

  for (const j of byId) {
    for (const c of conns[j]) {
      const t = _getNodeIndexById(c.target);
      if (t < 0) continue;
      if (nodes[j].outputCount < 8 /* MAX_LINKS */) {
        nodes[j].outputs.push(c.target);
        nodes[j].outputCount++;
      }
      const tn = nodes[t];
      if      (c.port === 0 && tn.input1 < 0) tn.input1 = j;
      else if (c.port === 1 && tn.input2 < 0) tn.input2 = j;
      else {
        // Cable sin puerto válido, o segundo cable al MISMO puerto: se usa el
        // puerto libre (igual que el firmware anterior) o se descarta; se avisa.
        if      (tn.input1 < 0) tn.input1 = j;
        else if (tn.input2 < 0) tn.input2 = j;
        if (c.port === 0 || c.port === 1)
          console.warn(`[PLC] AVISO: nodo ${tn.id}, puerto ${c.port + 1} con mas de un cable (nodo ${nodes[j].id})`);
      }
    }
  }

  // ── PASADA 3: idioma heredado SR(S=X, R=NOT X) = registro de 1 scan ──
  for (let i = 0; i < nc; i++) {
    if (nodes[i].type !== 'sr') continue;
    const a = nodes[i].input1, b = nodes[i].input2;
    if (a < 0 || b < 0) continue;
    if (nodes[b].type === 'not' && nodes[b].input1 === a && nodes[b].input2 < 0)
      nodes[i].type = 'prev';
  }

  // ── PASADA 4: orden de ejecución ─────────────────────────────
  buildExecOrder();

  // ── PASADA 5: registrar PWM ──────────────────────────────────
  for (let i = 0; i < nc; i++) {
    if (nodes[i].type === 'pwm') {
      plcRegisterPWM(nodes[i].outIdx);
      plcMarkPinAsPWM(nodes[i].outIdx);
    }
  }

  console.log(`[PLC] parseProgram OK: ${nc} nodos`);
}

// =============================================================
// plcScan — mirrors void plcScan() → plcScanNodes()
//
// Ejecuta UN ciclo de scan completo.
// Llamado cada 10ms por setInterval en plc_sim_scan.js.
//
// REPLICA EXACTA de plcScanNodes() de plc_runtime.cpp:
//   FASE 1:  Leer entradas físicas
//   FASE 2:  Lógica combinacional (AND, OR, NOT, XOR, CMP)
//   FASE 3a: Timers IEC 61131-3 (TON, TOF, TP, BLINK)
//   FASE 3b: Contadores IEC (CTU, CTD)
//   FASE 3c: Memorias / Biestables (SR, RS)
//   FASE 3d: Detección de flancos (R_TRIG, F_TRIG)
//   FASE 3e: SCALE — escalado lineal ADC → unidades físicas
//   FASE 4:  Nodos PWM
//   FASE 5:  Escribir salidas digitales
//   SYNC:    Mirror node states → SimState.mem (≡ plcMem)
// =============================================================
function plcScan() {
  if (SimState.plcMode !== PLC_MODE.RUN) return;

  // ── MODBUS INPUT SYNC: rdi[]→X[8+], rai[]→A[4+] ──────────────
  // mirrors readInputs() Modbus section in plc_memory.cpp
  // Must run BEFORE scan phases so remote inputs are visible to program.
  if (typeof simReadRemoteInputs === 'function') simReadRemoteInputs();

  const t0    = performance.now();
  const nodes = SimState.nodes;
  const nc    = SimState.nodeCount;

  // performance.now() ≡ millis() — alta resolución, misma semántica
  const now = performance.now();

  // =========================================================
  // FASE 1: Leer entradas físicas
  // mirrors plcScanNodes() FASE 1
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const inIdx = _getInputPhysIndex(nodes[i].name);
    if (inIdx >= 0) {
      nodes[i].state = plcReadInput(inIdx);
    }

    const anIdx = _getAnalogPhysIndex(nodes[i].name);
    if (anIdx >= 0) {
      nodes[i].intValue = plcReadAnalog(anIdx);
      nodes[i].state    = (nodes[i].intValue > 2048);
    }
  }

  // MEMORY SYNC: mirror physical inputs → mem.X[]  (mirrors readInputs())
  for (let i = 0; i < NUM_INPUTS; i++) {
    SimState.mem.X[i] = plcReadInput(i);
  }
  for (let i = 0; i < NUM_ANALOG; i++) {
    SimState.mem.A[i] = plcReadAnalog(i);
  }

  // =========================================================
  // FASE 2: evaluar cada nodo una vez, en orden de dependencias
  // mirrors plcScan() FASE 2 (switch por tipo)
  // =========================================================
  const order = SimState.execOrder || [];
  for (let e = 0; e < order.length; e++) {
    const n = nodes[order[e]];
    switch (n.type) {
      case 'and': n.state = _inState(n, 0) && _inState(n, 1); break;
      case 'or':  n.state = _inState(n, 0) || _inState(n, 1); break;
      case 'not': n.state = !_inState(n, 0); break;
      case 'xor': n.state = _inState(n, 0) !== _inState(n, 1); break;

      case 'cmp': {
        const val1 = _getNodeIntValue(n.input1);
        const val2 = n.input2 >= 0 ? _getNodeIntValue(n.input2) : n.value;
        const op = n.op;
        if      (op === '>')  n.state = (val1 >  val2);
        else if (op === '<')  n.state = (val1 <  val2);
        else if (op === '>=') n.state = (val1 >= val2);
        else if (op === '<=') n.state = (val1 <= val2);
        else if (op === '==') n.state = (val1 === val2);
        else if (op === '!=') n.state = (val1 !== val2);
        else                  n.state = false;
        break;
      }

      case 'ton': {
        const IN = _inState(n, 0);
        if (IN) {
          if (!n.timerRunning) {
            n.timerRunning = true; n.timerDone = false; n.timerStart = now; n.state = false;
          } else if ((now - n.timerStart) >= n.preset) {
            n.state = true; n.timerDone = true;
          }
        } else {
          n.timerRunning = false; n.timerDone = false; n.state = false;
        }
        break;
      }

      case 'tof': {
        const IN = _inState(n, 0);
        const risingEdge  =  IN && !n.timerPrevIn;
        const fallingEdge = !IN &&  n.timerPrevIn;
        if (risingEdge) {
          n.state = true; n.timerRunning = false; n.timerDone = false;
        } else if (fallingEdge) {
          n.timerRunning = true; n.timerDone = false; n.timerStart = now; n.state = true;
        } else if (!IN && n.timerRunning) {
          if ((now - n.timerStart) >= n.preset) {
            n.state = false; n.timerRunning = false; n.timerDone = true;
          }
        } else if (!IN && n.timerDone) {
          n.state = false;
        } else if (IN) {
          n.state = true;
        }
        n.timerPrevIn = IN;
        break;
      }

      case 'tp': {
        const IN = _inState(n, 0);
        const risingEdge = IN && !n.timerPrevIn;
        if (risingEdge && !n.timerRunning) {
          n.timerRunning = true; n.timerDone = false; n.timerStart = now; n.state = true;
        } else if (n.timerRunning) {
          if ((now - n.timerStart) >= n.preset) {
            n.timerRunning = false; n.timerDone = true; n.state = false;
          }
        } else if (n.timerDone && !IN) {
          n.timerDone = false;
        }
        n.timerPrevIn = IN;
        break;
      }

      case 'blink': {
        const EN = n.input1 >= 0 ? nodes[n.input1].state : true;
        if (!EN) {
          n.state = false; n.blinkLast = now;
        } else {
          if ((now - n.blinkLast) >= n.preset) {
            n.blinkState = !n.blinkState; n.blinkLast = now;
          }
          n.state = n.blinkState;
        }
        break;
      }

      case 'ctu': {
        const CU = _inState(n, 0), R = _inState(n, 1);
        if (R) n.intValue = 0;
        else if (CU && !n.counterPrevCU) n.intValue++;
        n.state = (n.intValue >= n.value);
        n.counterPrevCU = CU;
        break;
      }

      case 'ctd': {
        const CD = _inState(n, 0), LD = _inState(n, 1);
        if (LD) n.intValue = n.value;
        else if (CD && !n.counterPrevCD) { if (n.intValue > 0) n.intValue--; }
        n.state = (n.intValue <= 0);
        n.counterPrevCD = CD;
        break;
      }

      case 'sr': {
        const S = _inState(n, 0), R = _inState(n, 1);
        if (S) n.state = true; else if (R) n.state = false;
        break;
      }

      case 'rs': {
        const S = _inState(n, 0), R = _inState(n, 1);
        if (R) n.state = false; else if (S) n.state = true;
        break;
      }

      case 'r_trig': {
        const IN = _inState(n, 0);
        n.state = IN && !n.trigPrevIn; n.trigPrevIn = IN;
        break;
      }

      case 'f_trig': {
        const IN = _inState(n, 0);
        n.state = !IN && n.trigPrevIn; n.trigPrevIn = IN;
        break;
      }

      case 'scale': {
        // Aritmética entera de 64 bits, división truncada hacia cero (= firmware)
        const raw    = n.input1 >= 0 ? BigInt(nodes[n.input1].intValue) : 0n;
        const inMin  = BigInt(n.scaleInMin),  inMax  = BigInt(n.scaleInMax);
        const outMin = BigInt(n.scaleOutMin), outMax = BigInt(n.scaleOutMax);
        if (inMax === inMin) {
          n.intValue = Number(BigInt.asIntN(32, outMin));
        } else {
          let scaled = (raw - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;  // BigInt: trunca hacia 0
          const lo = outMin < outMax ? outMin : outMax;
          const hi = outMin < outMax ? outMax : outMin;
          if (scaled < lo) scaled = lo;
          if (scaled > hi) scaled = hi;
          n.intValue = Number(BigInt.asIntN(32, scaled));
        }
        n.state = (n.intValue > 0);
        break;
      }

      case 'pwm': {
        let value = n.value;
        if (n.input1 >= 0) {
          const src = nodes[n.input1];
          value = _isNumericSource(src.type) ? src.intValue : (src.state ? 4095 : 0);
        }
        n.intValue = value;
        break;
      }

      case 'output1': case 'output2': case 'output3': case 'output4':
        n.state = _inState(n, 0);
        break;

      default: break;
    }
  }

  // FASE 3: registros de 1 scan (NT_PREV)
  for (let i = 0; i < nc; i++)
    if (nodes[i].type === 'prev') nodes[i].state = _inState(nodes[i], 0);

  // FASE 4: escribir salidas físicas y PWM
  // Dos pasadas: en el hardware plcWriteOutput() ignora los pines bajo PWM,
  // de modo que el PWM siempre gana sobre una salida digital en el mismo pin.
  for (let i = 0; i < nc; i++) {
    const outPhys = _getOutputPhysIndex(nodes[i].name);
    if (outPhys >= 0) plcWriteOutput(outPhys, nodes[i].state);
  }
  for (let i = 0; i < nc; i++) {
    if (nodes[i].type === 'pwm') plcWritePWM(nodes[i].outIdx, nodes[i].intValue);
  }

  // =========================================================
  // MEMORY SYNC: mirror node states → SimState.mem (≡ plcMem)
  // mirrors el bloque "MEMORY SYNC" al final de plcScanNodes()
  //
  // REGLAS DE MAPEO (idénticas al firmware):
  //   Y[]  ← getOutputPhysIndex(nm)
  //   A[]  ← getAnalogPhysIndex(nm)
  //   T[]  ← nm ∈ {ton,tof,tp,blink} → id % MEM_T_SIZE
  //   R[]  ← timers: id % MEM_R_SIZE  (ET elapsed ms)
  //   C[]  ← nm ∈ {ctu,ctd}           → id % MEM_C_SIZE
  //   R[]  ← counters: (id+16) % MEM_R_SIZE (CV current value)
  //   M[]  ← nm ∈ {sr,rs,r_trig,f_trig,and,or,not,xor,cmp} → id % MEM_M_SIZE
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;

    // Y[] — digital outputs
    const yIdx = _getOutputPhysIndex(nm);
    if (yIdx >= 0 && yIdx < MEM_Y_SIZE) {
      SimState.mem.Y[yIdx] = nodes[i].state;
    }

    // A[] — analog inputs
    const aIdx = _getAnalogPhysIndex(nm);
    if (aIdx >= 0 && aIdx < MEM_A_SIZE) {
      SimState.mem.A[aIdx] = nodes[i].intValue;
    }

    // T[] + R[] — timer Q outputs and elapsed time
    if (nm === 'ton' || nm === 'tof' || nm === 'tp' || nm === 'blink') {
      const tidx = nodes[i].id % MEM_T_SIZE;
      SimState.mem.T[tidx] = nodes[i].state;
      const ridx = nodes[i].id % MEM_R_SIZE;
      // ET = elapsed ms if running, else 0 (mirrors firmware)
      SimState.mem.R[ridx] = nodes[i].timerRunning
        ? Math.round(now - nodes[i].timerStart)
        : 0;
    }

    // C[] + R[] — counter Q outputs and current value
    if (nm === 'ctu' || nm === 'ctd') {
      const cidx = nodes[i].id % MEM_C_SIZE;
      SimState.mem.C[cidx] = nodes[i].state;
      const ridx = (nodes[i].id + 16) % MEM_R_SIZE;
      SimState.mem.R[ridx] = nodes[i].intValue;
    }

    // M[] — internal memory bits
    if (nm === 'sr'     || nm === 'rs'     || nm === 'r_trig' ||
        nm === 'f_trig' || nm === 'and'    || nm === 'or'     ||
        nm === 'not'    || nm === 'xor'    || nm === 'cmp') {
      const midx = nodes[i].id % MEM_M_SIZE;
      SimState.mem.M[midx] = nodes[i].state;
    }
  }

  // ── MODBUS OUTPUT SYNC: Y[8+]→rdo[] ──────────────────────────
  // mirrors writeOutputs() in plc_memory.cpp (the missing call fixed in firmware)
  // Must run AFTER scan so rdo[] reflects the computed Y[8+] values.
  if (typeof simWriteRemoteOutputs === 'function') simWriteRemoteOutputs();

  // Update scan metrics
  SimState.scanCount++;
  SimState.lastScanUs = Math.round((performance.now() - t0) * 1000); // µs
  SimState.lastScanMs = now;
}
