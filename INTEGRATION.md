# PLC-CORE-MDE Simulator — Instrucciones de integración

## Archivos del simulador (carpeta `simulator/`)

```
simulator/
  plc_sim_state.js    — SimState + makePlcNode() + constantes de memoria
  plc_sim_io.js       — capa IO (plcReadInput, plcWriteOutput, etc.)
  plc_sim_runtime.js  — parseProgram() + plcScan() (réplica de plcScanNodes)
  plc_sim_scan.js     — loop 10ms + interceptor fetch
  sim_panel.js        — panel flotante de IO (se inyecta en el DOM)
```

## Cómo integrar en `program.html`, `ladder.html` y `monitor.html`

Agregar estas 5 líneas al final del `<head>`, **antes de cualquier otro `<script>`**:

```html
<!-- ══ SIMULADOR PLC-CORE-MDE ══════════════════════════════════ -->
<script src="simulator/plc_sim_state.js"></script>
<script src="simulator/plc_sim_io.js"></script>
<script src="simulator/plc_sim_runtime.js"></script>
<script src="simulator/plc_sim_scan.js"></script>
<script src="simulator/sim_panel.js"></script>
<!-- ══════════════════════════════════════════════════════════ -->
```

**Crítico:** deben cargarse ANTES de los scripts inline del editor, porque
`plc_sim_scan.js` parchea `window.fetch` en el momento de carga.

Opcionalmente, agregar el banner al topbar:

```html
<div id="sim-banner">SIMULADOR ACTIVO</div>
```

## Para GitHub Pages

Estructura de archivos en el repositorio:

```
/
  index.html              ← página de inicio del simulador (ya creada)
  style.css               ← estilos globales (del proyecto)
  program.html            ← editor FBD (con las 5 líneas de script)
  ladder.html             ← editor Ladder (con las 5 líneas de script)
  monitor.html            ← monitor IO (con las 5 líneas de script)
  manual.html             ← manual (sin cambios)
  drawflow.min.js
  drawflow.min.css
  drawflow.style.js
  editor.js
  script.js
  js/
    api/plc_api.js
    compiler/compiler.js
    compiler/ladder_ast.js
    compiler/ladder_decompiler.js
    compiler/ladder_program.js
    compiler/symbol_table.js
    ui/memory_panel.js
  simulator/
    plc_sim_state.js
    plc_sim_io.js
    plc_sim_runtime.js
    plc_sim_scan.js
    sim_panel.js
```

## Contrato de compatibilidad

El simulador **NO modifica** ninguno de estos archivos:
- `compiler.js`
- `ladder_decompiler.js`
- `program.html`
- `ladder.html`
- `monitor.html`
- `plc_api.js`

La integración es aditiva: los scripts del simulador se cargan primero
y parchean `window.fetch`. Cuando los editores llaman a `fetch('/save')`,
`fetch('/plc/run')`, etc., reciben respuestas simuladas sin saber que no
hay ESP32.

## Verificación

Abrir la consola del browser. Al cargar cualquier editor deberías ver:

```
[SIM] Fetch interceptor instalado
[SIM] Boot completo. Simulador listo.
```

Al guardar un programa desde el editor FBD:

```
[PLC] Nodo[0] id=1 name=input1 preset=0 outIdx=0
[PLC] Nodo[1] id=2 name=ton preset=2000 outIdx=0
[PLC] parseProgram OK: N nodos
[SIM] Programa guardado y cargado
[SIM] Scan loop iniciado (10ms)
```

## Diferencias respecto al simulador viejo

| Aspecto | Simulador viejo | Este simulador |
|---|---|---|
| Motor | Réplica parcial del firmware | Réplica exacta de `plcScanNodes()` |
| BLINK EN | `IN` de la fase (incorrecto) | `input1` leído separadamente (correcto) |
| Memory sync T/C/M | Ausente | Presente — mirrors `id % MEM_*_SIZE` |
| R[] ET timers | Ausente | `id % MEM_R_SIZE` ← elapsed ms |
| R[] CV counters | Ausente | `(id+16) % MEM_R_SIZE` ← intValue |
| Panel timers | No | Sí — barras de progreso ET |
| Panel counters | No | Sí — barras CV/PV |
| Fuente de verdad | Interpretación propia | `plc_runtime.cpp` |
