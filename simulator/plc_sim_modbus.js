// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// Argentina
// Licensed under PLC-CORE-MDE License v1.0
// Educational use allowed
// Commercial use requires authorization
// =============================================================

// =============================================================
// plc_sim_modbus.js — PLC-CORE-MDE Cloud Simulator
// Simulates RS485 Modbus RTU master behaviour
//
// Mirrors plc_modbus.cpp:
//   modbusInit()
//   modbusStartDiscovery()
//   modbusRegisterSlave(addr, type, label)
//   modbusPoll()         — called from scan loop
//
// In simulator mode: all IO values are random/simulated.
// Remote DI values toggle slowly; AI values drift; DO can be
// written and read back; AO holds last written value.
// =============================================================

'use strict';

// Default simulated slave templates for auto-discovery
// When SCAN RS485 is pressed, these are returned as if discovered
const SIM_DISCOVERY_TEMPLATES = [
  { address: 1, type: ModuleType.WS_RELAY8  },
  { address: 2, type: ModuleType.WS_IO8     },
  { address: 3, type: ModuleType.WS_AI8     },
  { address: 4, type: ModuleType.MDE_MIXED  },
];

// Internal: simulated IO data per slave (separate from global tables)
const _simSlaveIO = {}; // keyed by address

let _discoveryTimer = null;

// =============================================================
// modbusInit — mirrors void modbusInit()
// =============================================================
function modbusInit() {
  SimState.mbSlaves      = [];
  SimState.mbSlaveCount  = 0;
  SimState.mbDiscoveryDone = false;
  console.log('[MODBUS] Sim init');
}

// =============================================================
// modbusRegisterSlave — mirrors void modbusRegisterSlave(...)
// Adds a slave to the table and assigns IO offsets
// =============================================================
function modbusRegisterSlave(address, type, label) {
  if (SimState.mbSlaveCount >= 16) return;

  const info = ModuleInfo[type] || { name:'UNKNOWN', di:0, do:0, ai:0, ao:0 };

  // Calculate IO offsets (pack sequentially)
  let rdiOff = 0, rdoOff = 0, raiOff = 0, raoOff = 0;
  for (const s of SimState.mbSlaves) {
    rdiOff += s.numDI;
    rdoOff += s.numDO;
    raiOff += s.numAI;
    raoOff += s.numAO;
  }

  const slave = makeModbusSlave({
    address,
    type,
    typeName: info.name,
    online:     true,
    discovered: true,
    rdiOff,
    rdoOff,
    raiOff,
    raoOff,
    numDI: info.di,
    numDO: info.do,
    numAI: info.ai,
    numAO: info.ao,
    pollCount:  0,
    errorCount: 0,
    label: label || `${info.name}@${String(address).padStart(2,'0')}`,
  });

  SimState.mbSlaves.push(slave);
  SimState.mbSlaveCount++;

  // Initialise simulated local IO for this slave
  _simSlaveIO[address] = {
    di: new Array(info.di).fill(false),
    do: new Array(info.do).fill(false),
    ai: new Array(info.ai).fill(0),
    ao: new Array(info.ao).fill(0),
    diPhase: new Array(info.di).fill(0),
    aiDrift: new Array(info.ai).fill(0),
  };

  // Seed random initial AI values so each module looks different
  for (let k = 0; k < info.ai; k++) {
    _simSlaveIO[address].ai[k]     = Math.floor(Math.random() * 4095);
    _simSlaveIO[address].aiDrift[k] = (Math.random() * 20) - 10;
  }

  console.log(`[MODBUS] Slave registered: ${slave.label} DI=${info.di} DO=${info.do} AI=${info.ai} AO=${info.ao}`);
}

// =============================================================
// modbusStartDiscovery — mirrors void modbusStartDiscovery()
// Simulates scanning addresses 1-10, "finds" template slaves
// =============================================================
function modbusStartDiscovery(callback) {
  // Clear existing slaves
  SimState.mbSlaves      = [];
  SimState.mbSlaveCount  = 0;
  SimState.mbDiscoveryDone = false;

  console.log('[MODBUS] Discovery started...');

  // Simulate discovery delay (RS485 scan takes ~1s on real HW)
  if (_discoveryTimer) clearTimeout(_discoveryTimer);
  _discoveryTimer = setTimeout(() => {
    for (const tmpl of SIM_DISCOVERY_TEMPLATES) {
      modbusRegisterSlave(tmpl.address, tmpl.type);
    }
    SimState.mbDiscoveryDone = true;
    console.log(`[MODBUS] Discovery done. Found ${SimState.mbSlaveCount} slaves.`);
    if (typeof callback === 'function') callback();
  }, 1500); // 1.5s simulated scan time
}

// =============================================================
// modbusPoll — mirrors void modbusPoll()
// Called from scan loop every ~100ms (every 10 scan cycles)
// Updates simulated remote IO values and copies to global tables
// =============================================================
let _pollCycle = 0;

function modbusPoll() {
  _pollCycle++;
  if (_pollCycle % 10 !== 0) return; // poll at ~100ms rate (10ms * 10)

  for (let s = 0; s < SimState.mbSlaveCount; s++) {
    const slave = SimState.mbSlaves[s];
    const io    = _simSlaveIO[slave.address];
    if (!io) continue;

    slave.pollCount++;

    // --- Simulate DI: slow toggle based on phase ---
    for (let k = 0; k < slave.numDI; k++) {
      io.diPhase[k] = (io.diPhase[k] + 1) % (80 + k * 15);
      if (io.diPhase[k] === 0) io.di[k] = !io.di[k];
      SimState.rdi[slave.rdiOff + k] = io.di[k];
    }

    // --- Simulate AI: drifting values ---
    for (let k = 0; k < slave.numAI; k++) {
      io.aiDrift[k] += (Math.random() - 0.5) * 5;
      io.ai[k] = clamp(io.ai[k] + Math.round(io.aiDrift[k]), 0, 4095);
      if (Math.abs(io.aiDrift[k]) > 30) io.aiDrift[k] *= 0.5;
      SimState.rai[slave.raiOff + k] = io.ai[k];
    }

    // --- DO: reflect what was written to rdo ---
    for (let k = 0; k < slave.numDO; k++) {
      io.do[k] = SimState.rdo[slave.rdoOff + k];
    }

    // --- AO: reflect what was written to rao ---
    for (let k = 0; k < slave.numAO; k++) {
      io.ao[k] = SimState.rao[slave.raoOff + k];
    }
  }
}

// =============================================================
// modbusGetStatusJson — mirrors modbusGetStatus() for web API
// Returns the JSON structure expected by monitor.html
// =============================================================
function modbusGetStatusJson() {
  return {
    slaves: SimState.mbSlaves.map(s => ({
      address:    s.address,
      label:      s.label,
      type:       s.type,
      typeName:   s.typeName,
      online:     s.online,
      discovered: s.discovered,
      di:         s.numDI,
      do:         s.numDO,
      ai:         s.numAI,
      ao:         s.numAO,
      polls:      s.pollCount,
      errors:     s.errorCount,
      rdiOff:     s.rdiOff,
      rdoOff:     s.rdoOff,
      raiOff:     s.raiOff,
      raoOff:     s.raoOff,
    })),
    rdi: Array.from(SimState.rdi.slice(0, 64)),
    rdo: Array.from(SimState.rdo.slice(0, 64)),
    rai: Array.from(SimState.rai.slice(0, 32)),
    rao: Array.from(SimState.rao.slice(0, 32)),
    discovered: SimState.mbDiscoveryDone,
  };
}

// =============================================================
// Manual slave management (for modbus_panel.js)
// =============================================================
function modbusAddSlave(address, type) {
  // Don't add duplicates
  if (SimState.mbSlaves.find(s => s.address === address)) {
    console.warn('[MODBUS] Slave already exists at address', address);
    return false;
  }
  modbusRegisterSlave(address, type);
  return true;
}

function modbusRemoveSlave(address) {
  const idx = SimState.mbSlaves.findIndex(s => s.address === address);
  if (idx >= 0) {
    delete _simSlaveIO[address];
    SimState.mbSlaves.splice(idx, 1);
    SimState.mbSlaveCount--;
    // Recalculate offsets
    let rdiOff = 0, rdoOff = 0, raiOff = 0, raoOff = 0;
    for (const s of SimState.mbSlaves) {
      s.rdiOff = rdiOff; rdiOff += s.numDI;
      s.rdoOff = rdoOff; rdoOff += s.numDO;
      s.raiOff = raiOff; raiOff += s.numAI;
      s.raoOff = raoOff; raoOff += s.numAO;
    }
    return true;
  }
  return false;
}
