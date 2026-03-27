// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// Argentina
// Licensed under PLC-CORE-MDE License v1.0
// Educational use allowed
// Commercial use requires authorization
// =============================================================

// =============================================================
// plc_sim_runtime.js — PLC-CORE-MDE Cloud Simulator
// Direct JavaScript port of plc_runtime.cpp
//
// Functions:
//   runtimeClear()       — reset node table
//   parseProgram(json)   — parse Drawflow JSON, build node table
//   plcScan()            — execute one PLC scan cycle
//
// Faithfully replicates all 5 scan phases from firmware:
//   Phase 1: Read physical inputs
//   Phase 2: Combinational logic (AND, OR, NOT, XOR, CMP)
//   Phase 3a: Timers (TON, TOF, TP, BLINK)
//   Phase 3b: Counters (CTU, CTD)
//   Phase 3c: Latches (SR, RS)
//   Phase 3d: Edge detection (R_TRIG, F_TRIG)
//   Phase 3e: Scaling (SCALE)
//   Phase 4: PWM outputs
//   Phase 5: Digital outputs
// =============================================================

'use strict';

const MAX_NODES = 128;
const MAX_LINKS = 16;

// =============================================================
// Helpers — mirrors static helpers in plc_runtime.cpp
// =============================================================

function getNodeIndexById(id) {
  for (let i = 0; i < SimState.nodeCount; i++) {
    if (SimState.nodes[i].id === id) return i;
  }
  return -1;
}

function getNodeIntValue(idx) {
  if (idx < 0) return 0;
  if (SimState.nodes[idx].name === 'analog1') return SimState.nodes[idx].intValue;
  return SimState.nodes[idx].state ? 1 : 0;
}

function getInputPhysIndex(name) {
  if (name === 'input1') return 0;
  if (name === 'input2') return 1;
  return -1;
}

function getOutputPhysIndex(name) {
  if (name === 'output1') return 0;
  if (name === 'output2') return 1;
  if (name === 'output3') return 2;
  if (name === 'output4') return 3;
  return -1;
}

function getAnalogPhysIndex(name) {
  if (name === 'analog1') return 0;
  return -1;
}

function clamp(val, mn, mx) {
  return Math.max(mn, Math.min(mx, val));
}

// =============================================================
// runtimeClear — mirrors void runtimeClear()
// =============================================================
function runtimeClear() {
  SimState.nodeCount = 0;
  SimState.nodes = [];
}

// =============================================================
// parseProgram — mirrors void parseProgram(String json)
// Reads Drawflow JSON, builds SimState.nodes array in 3 passes:
//   Pass 1: Load nodes from JSON
//   Pass 2: Resolve input1/input2 connections
//   Pass 3: Register PWM pins
// =============================================================
function parseProgram(jsonStr) {
  runtimeClear();

  if (!jsonStr || jsonStr.length === 0) {
    console.warn('[PLC] parseProgram: empty JSON');
    return;
  }

  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[PLC] JSON parse error:', e);
    return;
  }

  // Support both full drawflow export and bare data object
  let data = null;
  if (doc && doc.drawflow && doc.drawflow.Home && doc.drawflow.Home.data) {
    data = doc.drawflow.Home.data;
  } else if (doc && doc.Home && doc.Home.data) {
    data = doc.Home.data;
  } else if (doc && typeof doc === 'object') {
    // Maybe it's already the data object
    const keys = Object.keys(doc);
    if (keys.length > 0 && doc[keys[0]] && doc[keys[0]].name !== undefined) {
      data = doc;
    }
  }

  if (!data) {
    console.error('[PLC] parseProgram: cannot find drawflow data');
    return;
  }

  // ---- PASS 1: Load nodes ----
  for (const key of Object.keys(data)) {
    if (SimState.nodeCount >= MAX_NODES) break;

    const node = data[key];
    const nd = makePlcNode();

    nd.id   = parseInt(node.id) || parseInt(key);
    nd.name = node.name || '';

    // Read config from node.data — handles both string and number values
    // (mirrors the readInt / readULong lambdas in firmware)
    const readInt = (k) => {
      const v = node.data && node.data[k];
      if (v === null || v === undefined) return 0;
      const n = parseInt(v);
      return isNaN(n) ? 0 : n;
    };
    const readULong = (k) => {
      const v = node.data && node.data[k];
      if (v === null || v === undefined) return 0;
      const n = parseInt(v);
      return isNaN(n) ? 0 : n;
    };

    nd.value  = readInt('value');
    nd.outIdx = readInt('out');
    nd.preset = readULong('time');
    nd.op     = (node.data && node.data.op) ? node.data.op : '>';

    // Scale parameters
    nd.scaleInMin  = readInt('inMin');
    nd.scaleInMax  = readInt('inMax');  if (nd.scaleInMax  === 0) nd.scaleInMax  = 4095;
    nd.scaleOutMin = readInt('outMin');
    nd.scaleOutMax = readInt('outMax'); if (nd.scaleOutMax === 0) nd.scaleOutMax = 100;

    // Counter preset
    nd.counterVal = readInt('pv');

    // Collect output connections (target node IDs)
    nd.outputs = [];
    nd.outputCount = 0;
    if (node.outputs) {
      for (const portKey of Object.keys(node.outputs)) {
        const port = node.outputs[portKey];
        if (port && port.connections) {
          for (const conn of port.connections) {
            const targetId = parseInt(conn.node);
            if (!isNaN(targetId) && nd.outputCount < MAX_LINKS) {
              nd.outputs.push(targetId);
              nd.outputCount++;
            }
          }
        }
      }
    }

    console.log(`[PLC] Node[${SimState.nodeCount}] id=${nd.id} name=${nd.name} preset=${nd.preset} outIdx=${nd.outIdx}`);
    SimState.nodes.push(nd);
    SimState.nodeCount++;
  }

  // ---- PASS 2: Resolve input1/input2 connections ----
  for (let i = 0; i < SimState.nodeCount; i++) {
    SimState.nodes[i].input1 = -1;
    SimState.nodes[i].input2 = -1;
    let count = 0;
    for (let j = 0; j < SimState.nodeCount; j++) {
      for (let k = 0; k < SimState.nodes[j].outputCount; k++) {
        const targetIdx = getNodeIndexById(SimState.nodes[j].outputs[k]);
        if (targetIdx === i) {
          if      (count === 0) SimState.nodes[i].input1 = j;
          else if (count === 1) SimState.nodes[i].input2 = j;
          count++;
        }
      }
    }
  }

  // ---- PASS 3: Register PWM ----
  for (let i = 0; i < SimState.nodeCount; i++) {
    if (SimState.nodes[i].name === 'pwm') {
      plcRegisterPWM(SimState.nodes[i].outIdx);
      plcMarkPinAsPWM(SimState.nodes[i].outIdx);
      console.log(`[PLC] PWM registered at outIdx=${SimState.nodes[i].outIdx}`);
    }
  }

  console.log(`[PLC] parseProgram OK: ${SimState.nodeCount} nodes`);
}

// =============================================================
// plcScan — mirrors void plcScan()
// Called every 10ms by setInterval in plc_sim_scan.js
// =============================================================
function plcScan() {
  if (SimState.plcMode !== PLC_MODE.RUN) return;

  const nodes = SimState.nodes;
  const nc    = SimState.nodeCount;
  const now   = performance.now(); // high-res millis equivalent

  // =========================================================
  // PHASE 1: Read physical inputs
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const inIdx = getInputPhysIndex(nodes[i].name);
    if (inIdx >= 0) {
      nodes[i].state = plcReadInput(inIdx);
    }

    const anIdx = getAnalogPhysIndex(nodes[i].name);
    if (anIdx >= 0) {
      nodes[i].intValue = plcReadAnalog(anIdx);
      nodes[i].state    = (nodes[i].intValue > 2048);
    }
  }

  // =========================================================
  // PHASE 2: Combinational logic
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
      nodes[i].state = a !== b;
    }
    else if (nm === 'cmp') {
      const val1 = getNodeIntValue(nodes[i].input1);
      const val2 = nodes[i].input2 >= 0
                   ? getNodeIntValue(nodes[i].input2)
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
  // PHASE 3a: Timers IEC 61131-3 (TON, TOF, TP, BLINK)
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;
    const IN = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;

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
        nodes[i].timerDone = false;
      }
      nodes[i].timerPrevIn = IN;
    }

    else if (nm === 'blink') {
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
  // PHASE 3b: Counters IEC (CTU, CTD)
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;

    if (nm === 'ctu') {
      const CU = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const R  = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;
      if (R) {
        nodes[i].intValue = 0;
      } else if (CU && !nodes[i].counterPrevCU) {
        nodes[i].intValue++;
      }
      nodes[i].state         = (nodes[i].intValue >= nodes[i].value);
      nodes[i].counterPrevCU = CU;
    }

    else if (nm === 'ctd') {
      const CD = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
      const LD = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;
      if (LD) {
        nodes[i].intValue = nodes[i].value;
      } else if (CD && !nodes[i].counterPrevCD) {
        if (nodes[i].intValue > 0) nodes[i].intValue--;
      }
      nodes[i].state         = (nodes[i].intValue <= 0);
      nodes[i].counterPrevCD = CD;
    }
  }

  // =========================================================
  // PHASE 3c: Latches / Flip-flops (SR, RS)
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const nm = nodes[i].name;
    const S = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
    const R = nodes[i].input2 >= 0 ? nodes[nodes[i].input2].state : false;

    if (nm === 'sr') {
      // Set dominant
      if (S)      nodes[i].state = true;
      else if (R) nodes[i].state = false;
    }
    else if (nm === 'rs') {
      // Reset dominant
      if (R)      nodes[i].state = false;
      else if (S) nodes[i].state = true;
    }
  }

  // =========================================================
  // PHASE 3d: Edge detection (R_TRIG, F_TRIG)
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
  // PHASE 3e: SCALE — linear scaling ADC → physical units
  // =========================================================
  for (let i = 0; i < nc; i++) {
    if (nodes[i].name !== 'scale') continue;
    const raw    = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].intValue : 0;
    const inMin  = nodes[i].scaleInMin;
    const inMax  = nodes[i].scaleInMax;
    const outMin = nodes[i].scaleOutMin;
    const outMax = nodes[i].scaleOutMax;
    if (inMax === inMin) { nodes[i].intValue = outMin; continue; }
    const scaled = Math.round((raw - inMin) * (outMax - outMin) / (inMax - inMin) + outMin);
    nodes[i].intValue = clamp(scaled, Math.min(outMin, outMax), Math.max(outMin, outMax));
    nodes[i].state    = (nodes[i].intValue > 0);
  }

  // =========================================================
  // PHASE 4: PWM outputs
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
  // PHASE 5: Write digital outputs
  // =========================================================
  for (let i = 0; i < nc; i++) {
    const outPhys = getOutputPhysIndex(nodes[i].name);
    if (outPhys < 0) continue;
    const val = nodes[i].input1 >= 0 ? nodes[nodes[i].input1].state : false;
    nodes[i].state = val;
    plcWriteOutput(outPhys, val);
  }

  SimState.scanCount++;
  SimState.lastScanMs = now;
}
