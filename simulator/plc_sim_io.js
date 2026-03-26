// =============================================================
// plc_sim_io.js — PLC-CORE-MDE Cloud Simulator
// IO Abstraction Layer
//
// Mirrors the physical IO API from plc_io.h:
//   plcReadInput(), plcWriteOutput(), plcReadAnalog(), plcWritePWM()
//
// This file implements the SIMULATOR mode only.
// Future modes (LOCAL, USB, MODBUS_GATEWAY, TCP) should be added
// here as additional backends without changing the API surface.
//
// IO Backend interface:
//   readInput(n)       → bool
//   readAnalog(n)      → int 0-4095
//   writeOutput(n, v)  → void
//   writePWM(idx, v)   → void  (v: 0-4095)
// =============================================================

'use strict';

// =============================================================
// IO Backend Registry
// Add new backends here without touching the runtime.
// =============================================================
const IO_BACKENDS = {};

// ---- SIMULATOR backend (runs in browser, no hardware) -------
IO_BACKENDS.SIMULATOR = {
  name: 'SIMULATOR',

  readInput(n) {
    return SimState.inputs[n] === true;
  },

  readAnalog(n) {
    return (SimState.analog[n] !== undefined) ? SimState.analog[n] : 0;
  },

  writeOutput(n, val) {
    if (n >= 0 && n < SimState.outputs.length) {
      SimState.outputs[n] = !!val;
    }
  },

  writePWM(outIdx, value) {
    if (outIdx >= 0 && outIdx < SimState.pwmValues.length) {
      SimState.pwmValues[outIdx] = value;
      // Also reflect on digital output if value > 2048
      SimState.outputs[outIdx] = (value > 2048);
    }
  },

  registerPWM(outIdx) {
    // No hardware setup needed in simulator
  },

  markPinAsPWM(outIdx) {
    // No-op in simulator
  },
};

// ---- FUTURE: LOCAL backend (WebSerial / native ESP32) --------
// IO_BACKENDS.LOCAL = { ... };

// ---- FUTURE: TCP backend (WebSocket to ESP32) ----------------
// IO_BACKENDS.TCP = { ... };

// ---- FUTURE: USB backend (WebUSB serial) ---------------------
// IO_BACKENDS.USB = { ... };

// ---- FUTURE: MODBUS_GATEWAY backend --------------------------
// IO_BACKENDS.MODBUS_GATEWAY = { ... };

// =============================================================
// Active backend — switch here to change mode
// =============================================================
let _activeBackend = IO_BACKENDS.SIMULATOR;

function setIOBackend(name) {
  if (IO_BACKENDS[name]) {
    _activeBackend = IO_BACKENDS[name];
    console.log('[IO] Backend set to:', name);
  } else {
    console.warn('[IO] Unknown backend:', name);
  }
}

// =============================================================
// Public API — mirrors plc_io.h exactly
// =============================================================

function plcReadInput(n) {
  return _activeBackend.readInput(n);
}

function plcReadAnalog(n) {
  return _activeBackend.readAnalog(n);
}

function plcWriteOutput(n, val) {
  _activeBackend.writeOutput(n, val);
}

function plcWritePWM(outIdx, value) {
  _activeBackend.writePWM(outIdx, value);
}

function plcRegisterPWM(outIdx) {
  _activeBackend.registerPWM(outIdx);
}

function plcMarkPinAsPWM(outIdx) {
  _activeBackend.markPinAsPWM(outIdx);
}
