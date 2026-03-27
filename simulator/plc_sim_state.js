// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// Argentina
// Licensed under PLC-CORE-MDE License v1.0
// Educational use allowed
// Commercial use requires authorization
// =============================================================

// =============================================================
// plc_sim_state.js — PLC-CORE-MDE Cloud Simulator
// Mirrors firmware: plc_state.h, plc_runtime.h, plc_modbus.h
// Global mutable state — all simulator modules share this object
// =============================================================

'use strict';

// --- PLC mode enum (mirrors PLC_MODE in plc_state.h) ---
const PLC_MODE = { STOP: 'STOP', RUN: 'RUN' };

// =============================================================
// SimState — single global object, all modules read/write here
// =============================================================
const SimState = {

  // ---- Runtime ----
  plcMode: PLC_MODE.STOP,
  nodeCount: 0,
  nodes: [],           // Array of PlcNode objects

  // ---- Physical IO (NUM_INPUTS=2, NUM_OUTPUTS=4, NUM_ANALOG=1) ----
  inputs:  [false, false],     // digital inputs  (bool[2])
  outputs: [false, false, false, false], // digital outputs (bool[4])
  analog:  [0],                // analog inputs   (int[1]) 0-4095
  pwmValues: [0, 0, 0, 0],     // PWM values per outIdx

  // ---- Remote IO tables (Modbus) ----
  // mirrors: rdi[], rdo[], rai[], rao[] in plc_modbus.cpp
  rdi: new Array(64).fill(false),
  rdo: new Array(64).fill(false),
  rai: new Array(32).fill(0),
  rao: new Array(32).fill(0),

  // ---- Modbus slaves ----
  // mirrors: ModbusSlave mbSlaves[MODBUS_MAX_SLAVES]
  mbSlaves: [],
  mbSlaveCount: 0,
  mbDiscoveryDone: false,

  // ---- Simulator meta ----
  scanCount: 0,
  startTime: Date.now(),
  lastScanMs: 0,
  programJson: null,

  // ---- WiFi simulated state ----
  wifiEnabled: true,
};

// =============================================================
// PlcNode factory — mirrors PlcNode struct in plc_runtime.h
// =============================================================
function makePlcNode(overrides) {
  return Object.assign({
    id:           0,
    name:         '',
    // Signals
    state:        false,
    intValue:     0,
    realValue:    0.0,
    // Connections
    input1:       -1,
    input2:       -1,
    outputCount:  0,
    outputs:      [],   // array of target node IDs
    // Config
    value:        0,    // static value / preset count
    outIdx:       0,    // physical output index
    preset:       0,    // timer preset ms / blink half-period
    op:           '>',  // CMP operator
    // Timer state (TON/TOF/TP/BLINK)
    timerStart:   0,
    timerElapsed: 0,
    timerRunning: false,
    timerDone:    false,
    timerPrevIn:  false,
    // Counter state (CTU/CTD)
    counterVal:   0,
    counterPrevCU: false,
    counterPrevCD: false,
    // Memory/latch (SR/RS)
    memState:     false,
    // Edge detection (R_TRIG/F_TRIG)
    trigPrevIn:   false,
    trigQ:        false,
    // Blink
    blinkState:   false,
    blinkLast:    0,
    // Scale
    scaleInMin:   0,
    scaleInMax:   4095,
    scaleOutMin:  0,
    scaleOutMax:  100,
  }, overrides);
}

// =============================================================
// ModbusSlave factory — mirrors ModbusSlave struct
// =============================================================
function makeModbusSlave(overrides) {
  return Object.assign({
    address:    0,
    type:       0,
    typeName:   'UNKNOWN',
    online:     false,
    discovered: false,
    rdiOff:     0,
    rdoOff:     0,
    raiOff:     0,
    raoOff:     0,
    numDI:      0,
    numDO:      0,
    numAI:      0,
    numAO:      0,
    pollCount:  0,
    errorCount: 0,
    label:      '',
  }, overrides);
}

// Module type enum — mirrors ModuleType in plc_modbus.h
const ModuleType = {
  UNKNOWN:      0,
  WS_RELAY8:    1,
  WS_RELAY16:   2,
  WS_IO8:       3,
  WS_AI8:       4,
  WS_AO8:       5,
  MDE_DI16:     0x10,
  MDE_DO16:     0x11,
  MDE_AI8:      0x12,
  MDE_AO8:      0x13,
  MDE_ETH:      0x20,
  MDE_MIXED:    0x30,
};

// Human-readable names and IO counts per module type
const ModuleInfo = {
  [ModuleType.WS_RELAY8]:  { name:'WS-RELAY8',  di:0, do:8,  ai:0, ao:0 },
  [ModuleType.WS_RELAY16]: { name:'WS-RELAY16', di:0, do:16, ai:0, ao:0 },
  [ModuleType.WS_IO8]:     { name:'WS-IO8',     di:8, do:8,  ai:0, ao:0 },
  [ModuleType.WS_AI8]:     { name:'WS-AI8',     di:0, do:0,  ai:8, ao:0 },
  [ModuleType.WS_AO8]:     { name:'WS-AO8',     di:0, do:0,  ai:0, ao:8 },
  [ModuleType.MDE_DI16]:   { name:'MDE-DI16',   di:16,do:0,  ai:0, ao:0 },
  [ModuleType.MDE_DO16]:   { name:'MDE-DO16',   di:0, do:16, ai:0, ao:0 },
  [ModuleType.MDE_AI8]:    { name:'MDE-AI8',    di:0, do:0,  ai:8, ao:0 },
  [ModuleType.MDE_AO8]:    { name:'MDE-AO8',    di:0, do:0,  ai:0, ao:8 },
  [ModuleType.MDE_MIXED]:  { name:'MDE-MIXED',  di:8, do:8,  ai:4, ao:4 },
};
