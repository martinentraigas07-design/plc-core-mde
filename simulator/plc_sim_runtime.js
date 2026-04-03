// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// plc_sim_runtime.js — v2 (IR-based simulator, Fase 1)
//
// FUENTE DE VERDAD: plc_runtime.cpp (plcScanNodes)
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

// mirrors static int getNodeIntValue(int idx)
function _getNodeIntValue(idx) {
  if (idx < 0) return 0;
  if (SimState.nodes[idx].name === 'analog1') return SimState.nodes[idx].intValue;
  return SimState.nodes[idx].state ? 1 : 0;
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
  runtimeClear();

  if (!jsonStr || jsonStr.length === 0) {
    console.warn('[PLC] parseProgram: JSON vacío');
    return;
  }

  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[PLC] JSON parse error:', e);
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
    console.error('[PLC] parseProgram: no se encontró drawflow.Home.data');
    return;
  }

  // ── PASADA 1: cargar nodos ───────────────────────────────────
  // mirrors firmware: readInt / readULong lambdas exactos
  for (const key of Object.keys(data)) {
    if (SimState.nodeCount >= 64 /* MAX_NODES */) break;

    const node = data[key];
    const nd = makePlcNode();

    nd.id   = parseInt(node.id) || parseInt(key) || 0;
    nd.name = (node.name || '').toLowerCase();

    // readInt: handles both string and number values — mirrors firmware lambda
    const readInt = (k) => {
      const v = node.data?.[k];
      if (v == null) return 0;
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : n;
    };

    // readULong: same as readInt (no negatives, ms values)
    const readULong = (k) => {
      const v = node.data?.[k];
      if (v == null) return 0;
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    };

    nd.value  = readInt('value');
    nd.outIdx = readInt('out');
    nd.preset = readULong('time');

    // op is always string — mirrors: n.op = node["data"]["op"] | ">"
    nd.op = (node.data?.op) || '>';

    // Counter preset (read as 'pv' key) — mirrors: n.counterVal = readInt("pv")
    nd.counterVal = readInt('pv');
    // NOTE: firmware stores current count in intValue, preset in value.
    // For CTU/CTD, value is the PV (preset value) read via readInt('value').
    // counterVal is read but not used for logic — intValue is the counter.

    // Scale parameters — mirrors firmware defaults
    nd.scaleInMin  = readInt('inMin');
    nd.scaleInMax  = readInt('inMax');  if (nd.scaleInMax  === 0) nd.scaleInMax  = 4095;
    nd.scaleOutMin = readInt('outMin');
    nd.scaleOutMax = readInt('outMax'); if (nd.scaleOutMax === 0) nd.scaleOutMax = 100;

    // Collect output connections (target Drawflow node IDs)
    nd.outputs = [];
    nd.outputCount = 0;
    if (node.outputs) {
      for (const portKey of Object.keys(node.outputs)) {
        const port = node.outputs[portKey];
        if (port?.connections) {
          for (const conn of port.connections) {
            const targetId = parseInt(conn.node, 10);
            if (!isNaN(targetId) && nd.outputCount < 8 /* MAX_LINKS */) {
              nd.outputs.push(targetId);
              nd.outputCount++;
            }
          }
        }
      }
    }

    console.log(`[PLC] Nodo[${SimState.nodeCount}] id=${nd.id} name=${nd.name} preset=${nd.preset} outIdx=${nd.outIdx}`);
    SimState.nodes.push(nd);
    SimState.nodeCount++;
  }

  // ── PASADA 2: resolver conexiones input1/input2 ──────────────
  // mirrors firmware PASADA 2 exactamente (O(n²))
  for (let i = 0; i < SimState.nodeCount; i++) {
    SimState.nodes[i].input1 = -1;
    SimState.nodes[i].input2 = -1;
    let count = 0;

    for (let j = 0; j < SimState.nodeCount; j++) {
      for (let k = 0; k < SimState.nodes[j].outputCount; k++) {
        const targetIdx = _getNodeIndexById(SimState.nodes[j].outputs[k]);
        if (targetIdx === i) {
          if      (count === 0) SimState.nodes[i].input1 = j;
          else if (count === 1) SimState.nodes[i].input2 = j;
          count++;
        }
      }
    }
  }

  // ── PASADA 3: registrar PWM ──────────────────────────────────
  for (let i = 0; i < SimState.nodeCount; i++) {
    if (SimState.nodes[i].name === 'pwm') {
      plcRegisterPWM(SimState.nodes[i].outIdx);
      plcMarkPinAsPWM(SimState.nodes[i].outIdx);
      console.log(`[PLC] PWM registrado en outIdx=${SimState.nodes[i].outIdx}`);
    }
  }

  console.log(`[PLC] parseProgram OK: ${SimState.nodeCount} nodos`);
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
  // FASE 2: Lógica combinacional
  // mirrors plcScanNodes() FASE 2
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;

    if (nm === 'and') {
      const a = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const b = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;
      nodes[i].state = a && b;
    }
    else if (nm === 'or') {
      const a = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const b = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;
      nodes[i].state = a || b;
    }
    else if (nm === 'not') {
      const a = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      nodes[i].state = !a;
    }
    else if (nm === 'xor') {
      const a = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const b = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;
      nodes[i].state = a !== b;   // XOR: a !== b (idéntico a a^b para bool)
    }
    else if (nm === 'cmp') {
      const val1 = _getNodeIntValue(nodes[i].input1);
      // CMP: usa input2 si está conectado, sino usa nodes[i].value
      // mirrors: int val2 = (nodes[i].input2 >= 0) ? getNodeIntValue(...) : nodes[i].value
      const val2 = nodes[i].input2 >= 0
                   ? _getNodeIntValue(nodes[i].input2)
                   : nodes[i].value;
      const op = nodes[i].op;
      if      (op === '>')  nodes[i].state = (val1 >  val2);
      else if (op === '<')  nodes[i].state = (val1 <  val2);
      else if (op === '>=') nodes[i].state = (val1 >= val2);
      else if (op === '<=') nodes[i].state = (val1 <= val2);
      else if (op === '==') nodes[i].state = (val1 === val2);
      else if (op === '!=') nodes[i].state = (val1 !== val2);
      else                  nodes[i].state = false;
    }
  }

  // =========================================================
  // FASE 3a: Timers IEC 61131-3 (TON, TOF, TP, BLINK)
  // mirrors plcScanNodes() FASE 3a — código idéntico instrucción a instrucción
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;
    const IN = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;

    // ── TON — Timer On Delay ──────────────────────────────────
    // mirrors:
    //   if (IN) {
    //     if (!timerRunning) { timerRunning=true; timerDone=false; timerStart=now; state=false; }
    //     else if (now-timerStart >= preset) { state=true; timerDone=true; }
    //   } else { timerRunning=false; timerDone=false; state=false; }
    if (nm === 'ton') {
      if (IN) {
        if (!nodes[i].timerRunning) {
          nodes[i].timerRunning = true;
          nodes[i].timerDone    = false;
          nodes[i].timerStart   = now;
          nodes[i].state        = false;
        } else if ((now - nodes[i].timerStart) >= nodes[i].preset) {
          nodes[i].state     = true;
          nodes[i].timerDone = true;
        }
      } else {
        nodes[i].timerRunning = false;
        nodes[i].timerDone    = false;
        nodes[i].state        = false;
      }
    }

    // ── TOF — Timer Off Delay ─────────────────────────────────
    // mirrors firmware TOF exactly (rising/falling edge detection)
    else if (nm === 'tof') {
      const risingEdge  =  IN && !nodes[i].timerPrevIn;
      const fallingEdge = !IN &&  nodes[i].timerPrevIn;

      if (risingEdge) {
        nodes[i].state        = true;
        nodes[i].timerRunning = false;
        nodes[i].timerDone    = false;
      } else if (fallingEdge) {
        nodes[i].timerRunning = true;
        nodes[i].timerDone    = false;
        nodes[i].timerStart   = now;
        nodes[i].state        = true;
      } else if (!IN && nodes[i].timerRunning) {
        if ((now - nodes[i].timerStart) >= nodes[i].preset) {
          nodes[i].state        = false;
          nodes[i].timerRunning = false;
          nodes[i].timerDone    = true;
        }
      } else if (!IN && nodes[i].timerDone) {
        nodes[i].state = false;
      } else if (IN) {
        nodes[i].state = true;
      }
      nodes[i].timerPrevIn = IN;
    }

    // ── TP — Timer Pulse ──────────────────────────────────────
    // mirrors firmware TP exactly (one-shot on rising edge)
    else if (nm === 'tp') {
      const risingEdge = IN && !nodes[i].timerPrevIn;

      if (risingEdge && !nodes[i].timerRunning) {
        nodes[i].timerRunning = true;
        nodes[i].timerDone    = false;
        nodes[i].timerStart   = now;
        nodes[i].state        = true;
      } else if (nodes[i].timerRunning) {
        if ((now - nodes[i].timerStart) >= nodes[i].preset) {
          nodes[i].timerRunning = false;
          nodes[i].timerDone    = true;
          nodes[i].state        = false;
        }
      } else if (nodes[i].timerDone && !IN) {
        // Reset timerDone when IN goes low (allows re-triggering)
        nodes[i].timerDone = false;
      }
      nodes[i].timerPrevIn = IN;
    }

    // ── BLINK — oscilador de ciclo configurable ───────────────
    // mirrors firmware BLINK:
    //   EN = input1 (or true if disconnected)
    //   toggles blinkState every preset ms
    else if (nm === 'blink') {
      // NOTE: BLINK reads EN from input1, not IN computed above
      const EN = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : true;

      if (!EN) {
        nodes[i].state     = false;
        nodes[i].blinkLast = now;
      } else {
        if ((now - nodes[i].blinkLast) >= nodes[i].preset) {
          nodes[i].blinkState = !nodes[i].blinkState;
          nodes[i].blinkLast  = now;
        }
        nodes[i].state = nodes[i].blinkState;
      }
    }
  }

  // =========================================================
  // FASE 3b: Contadores IEC (CTU, CTD)
  // mirrors plcScanNodes() FASE 3b
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;

    // ── CTU — Counter Up ─────────────────────────────────────
    // CU = input1 (flanco ascendente cuenta), R = input2 (reset)
    // Q = (intValue >= value)   [value = PV preset]
    // mirrors:
    //   if (R) intValue=0;
    //   else if (CU && !counterPrevCU) intValue++;
    //   state = (intValue >= value);
    //   counterPrevCU = CU;
    if (nm === 'ctu') {
      const CU = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const R  = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;

      if (R) {
        nodes[i].intValue = 0;
      } else if (CU && !nodes[i].counterPrevCU) {
        nodes[i].intValue++;
      }
      nodes[i].state        = (nodes[i].intValue >= nodes[i].value);
      nodes[i].counterPrevCU = CU;
    }

    // ── CTD — Counter Down ────────────────────────────────────
    // CD = input1 (flanco ascendente decrementa), LD = input2 (carga preset)
    // Q = (intValue <= 0)
    // mirrors:
    //   if (LD) intValue = value;
    //   else if (CD && !counterPrevCD) if (intValue>0) intValue--;
    //   state = (intValue <= 0);
    //   counterPrevCD = CD;
    else if (nm === 'ctd') {
      const CD = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const LD = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;

      if (LD) {
        nodes[i].intValue = nodes[i].value;
      } else if (CD && !nodes[i].counterPrevCD) {
        if (nodes[i].intValue > 0) nodes[i].intValue--;
      }
      nodes[i].state        = (nodes[i].intValue <= 0);
      nodes[i].counterPrevCD = CD;
    }
  }

  // =========================================================
  // FASE 3c: Memorias / Biestables (SR, RS)
  // mirrors plcScanNodes() FASE 3c
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;
    const S = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
    const R = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;

    // ── SR — Set dominante: S=1→Q=1, R=1 y S=0→Q=0 ──────────
    if (nm === 'sr') {
      if (S)      nodes[i].state = true;
      else if (R) nodes[i].state = false;
    }
    // ── RS — Reset dominante: R=1→Q=0, S=1 y R=0→Q=1 ────────
    else if (nm === 'rs') {
      if (R)      nodes[i].state = false;
      else if (S) nodes[i].state = true;
    }
  }

  // =========================================================
  // FASE 3d: Detección de flancos (R_TRIG, F_TRIG)
  // mirrors plcScanNodes() FASE 3d
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;
    const IN = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;

    if (nm === 'r_trig') {
      nodes[i].state      = IN && !nodes[i].trigPrevIn;
      nodes[i].trigPrevIn = IN;
    }
    else if (nm === 'f_trig') {
      nodes[i].state      = !IN && nodes[i].trigPrevIn;
      nodes[i].trigPrevIn = IN;
    }
  }

  // =========================================================
  // FASE 3e: SCALE — escalado lineal ADC → unidades físicas
  // mirrors plcScanNodes() FASE 3e
  //   scaled = (raw-inMin) * (outMax-outMin) / (inMax-inMin) + outMin
  //   constrain to [min(outMin,outMax), max(outMin,outMax)]
  // NOTE: firmware uses integer division (long), we use Math.round() to match
  // =========================================================
  for (let i = 0; i < nc; i++) {
    if (nodes[i].name !== 'scale') continue;

    const raw    = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].intValue : 0;
    const inMin  = nodes[i].scaleInMin;
    const inMax  = nodes[i].scaleInMax;
    const outMin = nodes[i].scaleOutMin;
    const outMax = nodes[i].scaleOutMax;

    if (inMax === inMin) {
      nodes[i].intValue = outMin;
    } else {
      const scaled = Math.round((raw - inMin) * (outMax - outMin) / (inMax - inMin) + outMin);
      nodes[i].intValue = _constrain(scaled, Math.min(outMin, outMax), Math.max(outMin, outMax));
    }
    nodes[i].state = (nodes[i].intValue > 0);
  }

  // =========================================================
  // FASE 4: Nodos PWM
  // mirrors plcScanNodes() FASE 4
  // =========================================================
  for (let i = 0; i < nc; i++) {
    if (nodes[i].name !== 'pwm') continue;

    let value = nodes[i].value;
    if (nodes[i].input1 >= 0) {
      const src = nodes[nodes[i].input1];
      if (src.name === 'analog1') {
        value = src.intValue;
      } else {
        value = src.state ? 4095 : 0;
      }
    }
    plcWritePWM(nodes[i].outIdx, value);
  }

  // =========================================================
  // FASE 5: Escribir salidas digitales
  // mirrors plcScanNodes() FASE 5
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const outPhys = _getOutputPhysIndex(nodes[i].name);
    if (outPhys < 0) continue;
    const val = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
    nodes[i].state = val;
    plcWriteOutput(outPhys, val);
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
