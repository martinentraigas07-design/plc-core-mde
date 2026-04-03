// =============================================================
// PLC-CORE-MDE Project
// Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
// simulator/plc_sim_modbus.js — Módulos RS485 para simulador
//
// FUENTE DE VERDAD: plc_modbus.h / plc_modbus.cpp / plc_memory.cpp
//
// NO implementa protocolo Modbus RTU.
// NO simula RS485 físico.
// SÍ replica:
//   - Estructura de datos ModbusSlave
//   - Tablas rdi/rdo/rai/rao (mirrors exactos del firmware)
//   - Algoritmo de offsets acumulativos (mirrors modbusRegisterSlave)
//   - Mapeo rdi→X[8+], rai→A[4+], Y[8+]→rdo (mirrors readInputs/writeOutputs)
//   - Tipos de módulo (mirrors enum ModuleType)
//   - Respuestas de endpoints /modbus/status y /modbus/discover
//
// Carga: <script src="simulator/plc_sim_modbus.js"></script>
// Debe cargarse DESPUÉS de plc_sim_state.js y ANTES de plc_sim_runtime.js
// =============================================================

// =============================================================
// Tipos de módulo — mirrors enum ModuleType de plc_modbus.h
// Incluye número de canales DI/DO/AI/AO por tipo.
// =============================================================
const SIM_MODULE_DEFS = {
  MOD_WS_RELAY8:  { id: 1,  name: 'WS-RELAY8',  di: 0, do: 8,  ai: 0, ao: 0 },
  MOD_WS_RELAY16: { id: 2,  name: 'WS-RELAY16', di: 0, do: 16, ai: 0, ao: 0 },
  MOD_WS_IO8:     { id: 3,  name: 'WS-IO8',     di: 8, do: 8,  ai: 0, ao: 0 },
  MOD_WS_AI8:     { id: 4,  name: 'WS-AI8',     di: 0, do: 0,  ai: 8, ao: 0 },
  MOD_WS_AO8:     { id: 5,  name: 'WS-AO8',     di: 0, do: 0,  ai: 0, ao: 8 },
  MOD_MDE_DI16:   { id: 16, name: 'MDE-DI16',   di: 16, do: 0, ai: 0, ao: 0 },
  MOD_MDE_DO16:   { id: 17, name: 'MDE-DO16',   di: 0, do: 16, ai: 0, ao: 0 },
  MOD_MDE_AI8:    { id: 18, name: 'MDE-AI8',    di: 0, do: 0,  ai: 8, ao: 0 },
  MOD_MDE_AO8:    { id: 19, name: 'MDE-AO8',    di: 0, do: 0,  ai: 0, ao: 8 },
  MOD_MDE_MIXED:  { id: 48, name: 'MDE-MIXED',  di: 8, do: 8,  ai: 4, ao: 4 },
};

// Lookup por id numérico (para serialización/deserialización)
function _simModuleDefById(id) {
  for (const key of Object.keys(SIM_MODULE_DEFS)) {
    if (SIM_MODULE_DEFS[key].id === id) return { key, ...SIM_MODULE_DEFS[key] };
  }
  return null;
}

// =============================================================
// Inicialización de tablas Modbus en SimState
// Llamada una vez al cargar este archivo.
// Extiende SimState con los campos necesarios para Modbus.
// mirrors: variables globales rdi/rdo/rai/rao y mbSlaves[] en plc_modbus.cpp
// =============================================================
(function initSimModbus() {
  // Tablas IO remotas — mirrors exactos de plc_modbus.cpp globals
  if (!SimState.rdi)          SimState.rdi = new Array(64).fill(false);  // Remote Digital Inputs
  if (!SimState.rdo)          SimState.rdo = new Array(64).fill(false);  // Remote Digital Outputs
  if (!SimState.rai)          SimState.rai = new Array(32).fill(0);      // Remote Analog Inputs
  if (!SimState.rao)          SimState.rao = new Array(32).fill(0);      // Remote Analog Outputs

  // Tabla de módulos — mirrors mbSlaves[MODBUS_MAX_SLAVES] + mbSlaveCount
  if (!SimState.mbSlaves)       SimState.mbSlaves = [];
  if (!SimState.mbSlaveCount)   SimState.mbSlaveCount = 0;
  if (SimState.mbDiscoveryDone === undefined) SimState.mbDiscoveryDone = false;
})();

// =============================================================
// makeSimModbusSlave — factory
// mirrors: struct ModbusSlave en plc_modbus.h
// =============================================================
function makeSimModbusSlave(overrides) {
  return Object.assign({
    address:    1,        // Modbus address (1–247)
    type:       0,        // ModuleType numeric id
    typeName:   'UNKNOWN',
    typeKey:    '',       // SIM_MODULE_DEFS key
    online:     true,     // always online in sim (no RS485 to fail)
    discovered: true,
    rdiOff: 0, rdoOff: 0, raiOff: 0, raoOff: 0,
    numDI: 0,  numDO: 0,  numAI: 0,  numAO: 0,
    pollCount:  0,
    errorCount: 0,
    label:      '',
  }, overrides);
}

// =============================================================
// simRegisterModule — mirrors modbusRegisterSlave()
//
// Assigns cumulative offsets into rdi/rdo/rai/rao tables,
// exactly as the firmware does in modbusRegisterSlave().
// Order of registration determines the offset mapping.
// =============================================================
function simRegisterModule(address, typeKey, labelOverride) {
  const def = SIM_MODULE_DEFS[typeKey];
  if (!def) {
    console.warn('[SIM-Modbus] Tipo desconocido:', typeKey);
    return null;
  }

  // Prevent duplicate addresses (mirrors firmware guard)
  for (const s of SimState.mbSlaves) {
    if (s.address === address) {
      console.warn('[SIM-Modbus] Dirección ya registrada:', address);
      return s;
    }
  }

  // Calculate cumulative offsets — mirrors firmware algorithm in modbusRegisterSlave()
  let diOff = 0, doOff = 0, aiOff = 0, aoOff = 0;
  for (const s of SimState.mbSlaves) {
    diOff += s.numDI;
    doOff += s.numDO;
    aiOff += s.numAI;
    aoOff += s.numAO;
  }

  const label = labelOverride || `${def.name}@${String(address).padStart(2, '0')}`;

  const slave = makeSimModbusSlave({
    address,
    type:     def.id,
    typeName: def.name,
    typeKey,
    numDI: def.di, numDO: def.do, numAI: def.ai, numAO: def.ao,
    rdiOff: diOff, rdoOff: doOff, raiOff: aiOff, raoOff: aoOff,
    label,
    online:     true,
    discovered: true,
  });

  SimState.mbSlaves.push(slave);
  SimState.mbSlaveCount = SimState.mbSlaves.length;
  // Mark discovery done so /modbus/status returns modules immediately
  // (no need to press Discover after manually adding a module)
  SimState.mbDiscoveryDone = true;

  console.log(
    `[SIM-Modbus] Registrado: ${label} ` +
    `DI=${def.di} DO=${def.do} AI=${def.ai} AO=${def.ao} ` +
    `rdiOff=${diOff} rdoOff=${doOff} raiOff=${aiOff} raoOff=${aoOff}`
  );

  // Persist to localStorage
  _simModbusSave();

  return slave;
}

// =============================================================
// simUnregisterModule — removes module by address
// =============================================================
function simUnregisterModule(address) {
  const idx = SimState.mbSlaves.findIndex(s => s.address === address);
  if (idx < 0) return false;

  SimState.mbSlaves.splice(idx, 1);

  // Recalculate all offsets after removal (order-dependent)
  _simRecalcOffsets();

  SimState.mbSlaveCount = SimState.mbSlaves.length;
  _simModbusSave();
  console.log(`[SIM-Modbus] Removido: addr=${address}`);
  return true;
}

function _simRecalcOffsets() {
  let diOff = 0, doOff = 0, aiOff = 0, aoOff = 0;
  for (const s of SimState.mbSlaves) {
    s.rdiOff = diOff; s.rdoOff = doOff;
    s.raiOff = aiOff; s.raoOff = aoOff;
    diOff += s.numDI; doOff += s.numDO;
    aiOff += s.numAI; aoOff += s.numAO;
  }
}

// =============================================================
// simStartDiscovery — mirrors modbusStartDiscovery() + discovery loop
//
// In the simulator, discovery is instantaneous (no RS485 bus to scan).
// Optionally accepts a list of modules to "discover".
// Without arguments: resets discovery state (simulates empty scan).
// =============================================================
function simStartDiscovery(moduleList) {
  SimState.mbDiscoveryDone = false;

  if (moduleList && moduleList.length > 0) {
    // Register provided modules as if discovered
    for (const m of moduleList) {
      simRegisterModule(m.address, m.typeKey, m.label);
    }
  }

  // Simulate ~500ms discovery latency (mirrors MODBUS_DISC_TIMEOUT * 10 addresses)
  setTimeout(() => {
    SimState.mbDiscoveryDone = true;
    console.log(`[SIM-Modbus] Discovery completo. ${SimState.mbSlaveCount} módulos.`);
    if (typeof simPanelRefresh === 'function') simPanelRefresh();
  }, 500);
}

// =============================================================
// simReadRemoteInputs — mirrors readInputs() Modbus section in plc_memory.cpp
//
// Called BEFORE plcScan() so that X[8+] and A[4+] reflect remote inputs.
//   rdi[] → plcMem.X[8+]   (mirrors: plcMem.X[8+i] = rdi[i])
//   rai[] → plcMem.A[4+]   (mirrors: plcMem.A[4+i] = rai[i])
// =============================================================
function simReadRemoteInputs() {
  const m = SimState.mem;

  // rdi[] → X[8+]  (mirrors: for i < MODBUS_MAX_RDI && (8+i) < MEM_X_SIZE)
  for (let i = 0; i < 64 && (8 + i) < 64; i++) {
    m.X[8 + i] = SimState.rdi[i] ? true : false;
  }

  // rai[] → A[4+]  (mirrors: for i < MODBUS_MAX_RAI && (4+i) < MEM_A_SIZE)
  for (let i = 0; i < 32 && (4 + i) < 16; i++) {
    m.A[4 + i] = SimState.rai[i] || 0;
  }
}

// =============================================================
// simWriteRemoteOutputs — mirrors writeOutputs() in plc_memory.cpp
//                         (the function that was MISSING from firmware)
//
// Called AFTER plcScan() so that rdo[] reflects the computed Y[8+].
//   plcMem.Y[8+] → rdo[]  (mirrors: rdo[i] = plcMem.Y[8+i])
//
// NOTE: The physical output part (Y[0..3] → GPIO) is already handled
// by the simulator's IO layer. Only the Modbus remote part is needed here.
// =============================================================
function simWriteRemoteOutputs() {
  const m = SimState.mem;

  // Y[8+] → rdo[]  (mirrors: for i < MODBUS_MAX_RDO && (8+i) < MEM_Y_SIZE)
  for (let i = 0; i < 64 && (8 + i) < 64; i++) {
    SimState.rdo[i] = m.Y[8 + i] ? true : false;
  }
  // (rao[] left for future AO support — no equivalent in current firmware either)
}

// =============================================================
// Persistence — save/restore module table to localStorage
// =============================================================
function _simModbusSave() {
  try {
    localStorage.setItem('sim_modbus_slaves', JSON.stringify(
      SimState.mbSlaves.map(s => ({ address: s.address, typeKey: s.typeKey, label: s.label }))
    ));
  } catch(e) {}
}

function _simModbusLoad() {
  try {
    const raw = localStorage.getItem('sim_modbus_slaves');
    if (!raw) return;
    const list = JSON.parse(raw);
    for (const m of list) {
      simRegisterModule(m.address, m.typeKey, m.label);
    }
    SimState.mbDiscoveryDone = list.length > 0;
    console.log(`[SIM-Modbus] Restaurados ${list.length} módulos desde localStorage.`);
  } catch(e) {
    console.warn('[SIM-Modbus] No se pudo restaurar módulos:', e);
  }
}

// Restore persisted modules on load
_simModbusLoad();
