// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// plc_sim_io.js — v2 (IR-based simulator)
//
// FUENTE DE VERDAD: plc_io.h / plc_io.cpp
// Implementa la capa IO del simulador.
// Expone exactamente la misma API que el firmware:
//   plcReadInput(n)     → bool
//   plcWriteOutput(n,v) → void
//   plcReadAnalog(n)    → int 0-4095
//   plcWritePWM(idx,v)  → void
//   plcRegisterPWM(idx) → void (no-op en sim)
//   plcMarkPinAsPWM(idx)→ void (no-op en sim)
// =============================================================

'use strict';

// =============================================================
// IO Backend — SIMULATOR (reads/writes SimState directly)
// =============================================================

function plcReadInput(n) {
  return SimState.inputs[n] === true;
}

function plcReadAnalog(n) {
  const v = SimState.analog[n];
  return (v !== undefined) ? v : 0;
}

function plcWriteOutput(n, val) {
  if (n >= 0 && n < SimState.outputs.length) {
    SimState.outputs[n] = !!val;
  }
}

function plcWritePWM(outIdx, value) {
  if (outIdx >= 0 && outIdx < SimState.pwmValues.length) {
    SimState.pwmValues[outIdx] = value;
    // Mirror threshold onto digital output (mirrors firmware behaviour)
    SimState.outputs[outIdx] = (value > 2048);
  }
}

function plcRegisterPWM(/*outIdx*/) {
  // No-op in simulator — no hardware pin setup required
}

function plcMarkPinAsPWM(/*outIdx*/) {
  // No-op in simulator
}
