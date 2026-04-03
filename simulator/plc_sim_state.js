// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// plc_sim_state.js — v2 (IR-based simulator)
//
// FUENTE DE VERDAD: plc_runtime.cpp / plc_runtime.h / plc_memory.h
// Mirrors exactamente:
//   - PlcNode struct  (plc_runtime.h)
//   - PlcMemory struct (plc_memory.h)
//   - MEM_*_SIZE constants
// =============================================================

'use strict';

// ── PLC mode enum (mirrors plc_state.h PLC_MODE) ─────────────
const PLC_MODE = Object.freeze({ STOP: 'STOP', RUN: 'RUN' });

// ── Memory size constants (mirrors plc_memory.h) ─────────────
const MEM_X_SIZE = 64;
const MEM_Y_SIZE = 64;
const MEM_M_SIZE = 64;
const MEM_T_SIZE = 32;
const MEM_C_SIZE = 32;
const MEM_R_SIZE = 32;
const MEM_A_SIZE = 16;

// ── Physical IO counts (mirrors plc_io.h) ────────────────────
const NUM_INPUTS  = 2;
const NUM_OUTPUTS = 4;
const NUM_ANALOG  = 1;

// =============================================================
// SimState — single mutable object shared across all modules
// Mirrors: PlcMemory + runtime globals + IO state
// =============================================================
const SimState = {

  // ── Runtime ──
  plcMode:   PLC_MODE.STOP,
  nodeCount: 0,
  nodes:     [],   // Array<PlcNode>

  // ── Physical IO (mirrors plc_io.cpp hardware layer) ──────
  // inputs[0] = input1, inputs[1] = input2
  inputs:    [false, false],
  // outputs[0]=output1 … outputs[3]=output4
  outputs:   [false, false, false, false],
  // analog[0] = analog1 (0-4095)
  analog:    [0],
  // pwmValues per outIdx (0-4095)
  pwmValues: [0, 0, 0, 0],

  // ── PlcMemory mirror (mirrors PlcMemory struct) ───────────
  // Updated at end of each scan — same as firmware memory sync
  mem: {
    X: new Array(MEM_X_SIZE).fill(false),
    Y: new Array(MEM_Y_SIZE).fill(false),
    M: new Array(MEM_M_SIZE).fill(false),
    T: new Array(MEM_T_SIZE).fill(false),
    C: new Array(MEM_C_SIZE).fill(false),
    R: new Array(MEM_R_SIZE).fill(0),
    A: new Array(MEM_A_SIZE).fill(0),
  },

  // ── Scan metrics (mirrors plcScanCount / plcScanUs) ──────
  scanCount:    0,
  lastScanUs:   0,
  startTime:    Date.now(),
  lastScanMs:   0,

  // ── Stored program JSON (for /load endpoint) ─────────────
  programJson:  null,

  // ── WiFi simulated state ─────────────────────────────────
  wifiEnabled:  true,
};

// =============================================================
// PlcNode factory
// Mirrors exactly: struct PlcNode in plc_runtime.h
// ALL fields must match — scan code indexes by property name.
// =============================================================
function makePlcNode() {
  return {
    id:           0,
    name:         '',

    // Signal outputs
    state:        false,
    intValue:     0,
    realValue:    0.0,

    // Resolved connections (set by parseProgram pass 2)
    input1:       -1,   // index into SimState.nodes[]
    input2:       -1,
    outputCount:  0,
    outputs:      [],   // array of Drawflow target node IDs

    // Config params (from drawflow node.data)
    value:        0,    // CMP threshold / counter PV / PWM fixed
    op:           '>',  // CMP operator
    outIdx:       0,    // physical output index (0-3)
    preset:       0,    // timer preset ms / blink half-period ms

    // Timer state (mirrors PlcNode timer fields)
    timerStart:   0,    // performance.now() timestamp
    timerElapsed: 0,
    timerRunning: false,
    timerDone:    false,
    timerPrevIn:  false,

    // Counter state (mirrors PlcNode counter fields)
    counterVal:    0,   // NOTE: runtime uses intValue for current count
    counterPrevCU: false,
    counterPrevCD: false,

    // Memory/latch state (SR/RS)
    memState:     false,

    // Edge detection (R_TRIG / F_TRIG)
    trigPrevIn:   false,
    trigQ:        false,

    // Blink oscillator
    blinkState:   false,
    blinkLast:    0,

    // SCALE parameters
    scaleInMin:   0,
    scaleInMax:   4095,
    scaleOutMin:  0,
    scaleOutMax:  100,
  };
}
