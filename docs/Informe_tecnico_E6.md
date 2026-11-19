# Informe técnico final — PLC-CORE-MDE 6.0.0-rc.1 (Etapa E6)

**Estado:** candidata a entrega. Validada en PC; **no validada en hardware**. **No se compiló para ESP32** (ver 4). No se publicó nada en GitHub ni se crearon tags/releases.

## 1. Archivos (respecto de la versión original recibida)
**Eliminados:** ninguno.

**Agregados**
- `tests/` completa (host): 31 scripts/baterías, harness, `hostfw/` (shims de Arduino y driver), `size/measure.cpp`.
- `js/compiler/ir_check.js` (verificador diferencial de IR).
- `docs/Manual_PLC_CORE_MDE_COMPLETO_v3.pdf`, `docs/Informe_E5.md` (en `docs/build_manual/`), `docs/Informe_tecnico_E6.md`, `docs/Checklist_pruebas_fisicas.md`, `docs/build_manual/` (scripts y parches de reconstrucción del manual).
- `CHANGELOG.md`, `VERSION`.

**Modificados**
- Firmware: `plc_runtime.cpp`, `plc_runtime.h`, `plc_control.cpp`, `storage.cpp`, `web_server.cpp`, `PLC_CORE_MDE.ino` (únicamente `/load` con `streamFile`; además cambió el fin de línea CRLF→LF, sin efecto en la compilación), `firmware/MANUAL_PROGRAMACION.md` (texto: regla R_TRIG/CTU y ciclo de scan).
- Web: `js/compiler/compiler.js`, `ladder_ast.js`, `ladder_decompiler.js`, `ladder_program.js`, `ladder.html`, `simulator/plc_sim_runtime.js`; en E6, `manual.html` y `firmware/data/manual.html` (solo texto), `README.md`.

**Sin cambios:** hardware (KiCad, STL), licencias y `NOTICE`, `firmware/data/*` salvo `manual.html`, pines, comunicación Modbus (`plc_modbus.*`), `plc_io.*`, `plc_state.*`, `plc_tags.*`.
Se conservó el PDF del manual v2 y el informe técnico original (`docs/PLC_CORE_MDE_Informe_Tecnico.pdf`).

## 2. Correcciones realizadas
Detalle completo en `CHANGELOG.md`. Resumen: motor determinista (orden por dependencias, corte de lazos, puertos por conexión, SCALE entero con truncamiento), persistencia transaccional y recuperación, simulador espejo del firmware, compilador con orden/puertos/variables numéricas, Ladder ampliado (flancos, CMP, BLINK, analógicos/PWM, XOR) con rechazo explícito de lo no convertible, protección de programas ante conversiones o archivos dañados, ruta única de compilación Ladder, manual didáctico v3 con 51 cambios registrados.

## 3. Resultados de las pruebas (PC)
`ARDUINOJSON=<ruta>/ArduinoJson/src ./tests/run_all.sh` → **31 baterías, 0 FAIL** (las 30 anteriores más `t_e6_audit`). Ver `docs/resultados_E6_run_all.txt`.

La auditoría estática (`t_e6_audit.js`, 119 verificaciones) comprobó: referencias locales de todas las páginas (raíz y `firmware/data/`), sintaxis de todos los `.js` y de los scripts inline, que cada `fetch('/...')` de las páginas tenga su `server.on` en el firmware, que cada `#include "..."` local del firmware exista, y que FBD (`compileProject`) y Ladder (`compileLadder`) envíen por la misma `PlcApi.saveProgram` al mismo `/save` y se ejecuten en un único runtime.

Lo que las pruebas **sí** cubren: motor (firmware real `plc_runtime.cpp` compilado en el host con shims) contra el simulador real; compiladores; conversión FBD↔Ladder (diferencial y con oráculo IR, **no prueba formal**); compatibilidad con programas guardados por versiones anteriores (fixtures reconstruidos a partir de los formatos que produjo el editor); guardado/carga (en el host: formatos y límites de memoria estimados de ArduinoJson); ejemplos del manual.
Lo que **no** cubren: ADC, PWM LEDC, SPIFFS, WiFi/WebServer reales, RS-485, heap y tiempos reales del ESP32, ni el código de `plc_io.cpp`, `plc_modbus.cpp`, `storage.cpp`, `web_server.cpp` y `.ino` (no se ejecutan en el host).

## 4. Compilación para ESP32
**No realizada.** Intenté preparar la toolchain (arduino-cli y core arduino-esp32 2.0.17 desde GitHub); el entorno bloqueó la descarga de los binarios y no hay acceso al registro de PlatformIO. No hay, por lo tanto, resultado de compilación: **no debe leerse como "compila" ni como "no compila"**. Chequeos parciales hechos: sintaxis JS, includes locales, y compilación en el host del único módulo con shims (`plc_runtime.cpp`).
Punto a revisar en la compilación real: el código usa `ledcSetup/ledcAttachPin/ledcDetachPin` (API del core 2.x; **no existe en 3.x**), de modo que hay que usar arduino-esp32 **2.x** (p. ej. 2.0.17) o portar esas llamadas.

## 5. Limitaciones conocidas
- Lazos de realimentación con 2 o más memorias: el comportamiento depende de los ID internos de los nodos; no se convierten a Ladder (ejercicios 2.4, 8.3 y 10.5 del manual).
- El maestro Modbus existe en el driver; no hay nodos RDI/RDO/RAI/RAO en editor/compilador/runtime.
- SCALE trunca hacia cero (se recomienda escalar a décimas y comparar enteros).
- Máximos de nodos y tamaño de documento JSON limitados por la RAM (capacidades escalonadas en `parseProgram`).
- El modelo de evaluación es propio (no implementa un "snapshot IEC 61131-3").
- Los ejemplos de seguridad del manual son didácticos; no hay certificación funcional.

## 6. Riesgos pendientes
1. **Interfaz embebida vs. web (importante, sin resolver):** el ESP32 sirve `firmware/data/` (interfaz FBD original, con `program.html`, `monitor.html`, etc. distintos de los de la raíz). **`ladder.html`, `js/` y `simulator/` no están en `firmware/data/`**, así que hoy el editor Ladder v4 y el compilador de la raíz solo funcionan desde la versión web (navegador/GitHub Pages) y no desde el ESP32. No lo modifiqué porque implicaría una decisión de empaquetado (y de espacio SPIFFS) sin pruebas físicas. Hay que decidir: (a) mantener ambas interfaces, (b) sincronizar `firmware/data/` con la raíz tras medir el espacio SPIFFS. Debe validarse que el programa guardado por la UI web carga en el firmware (la prueba `t_persist` lo cubre en host).
2. Compilación para ESP32 y comportamiento físico sin verificar (ver checklist).
3. Memoria: un envelope de ~77 KB se transmite por `streamFile`, pero `parseProgram` usa `DynamicJsonDocument` de capacidad finita; verificar heap real.
4. Comportamiento del pin cuando una salida tiene PWM y digital a la vez: conocido por lectura de código, no probado.
5. Coherencia de versiones: el `.ino` conserva el encabezado "v5" y `manual.html` "v5"; el runtime se declara "v6". La versión propuesta es 6.0.0-rc.1.
6. `drawflow.style.js` (en la raíz y en `firmware/data/`) es un módulo ES (`import ... from "lit-element"`) que no referencia ninguna página; se dejó sin tocar.
7. Seguridad de red: el AP usa clave fija `12345678` y los endpoints no tienen autenticación (preexistente, no modificado).

## 7. Dependencias necesarias
- **Firmware:** Arduino-ESP32 core 2.x (WiFi, WebServer, SPIFFS, FreeRTOS, `driver/ledc.h`, `HardwareSerial`), **ArduinoJson 6.x**, placa ESP32 Dev Module (DevKit V1) con esquema de particiones que incluya SPIFFS.
- **Pruebas en PC:** Node.js (probado con v22), `g++` con C++17, ArduinoJson 6.x (fuente), y `jsdom` para `t_ui` (ver `tests/ui_boot.js`).
- **Rebuild del manual (opcional):** Python 3 con `reportlab`.

## 8. Procedimiento de compilación y carga (a verificar en banco)
1. Instalar el core **esp32 2.x** y ArduinoJson 6.x; abrir `firmware/PLC_CORE_MDE.ino` (la carpeta contiene todos los `.cpp/.h`).
2. Placa: ESP32 Dev Module; esquema de particiones con SPIFFS; compilar y anotar tamaño de programa y RAM.
3. Subir `firmware/data/` a SPIFFS (plugin de carga de datos o `mkspiffs`/`esptool`, según el IDE).
4. Grabar el firmware. Conectarse a la red `PLC_CORE_MDE` y abrir `192.168.4.1`.
5. Ejecutar `docs/Checklist_pruebas_fisicas.md`.

## 9. Validación recomendada del servidor web y del simulador
**Simulador (PC):** servir la raíz con un servidor estático (`python3 -m http.server`) y abrir `program.html`/`ladder.html`; cargar los ejemplos del manual v3 y comparar con las tablas ejecutadas del manual. Ejecutar `tests/run_all.sh` y `node tests/t_e6_audit.js`.
**Servidor web (ESP32):** con el PLC en el AP: comprobar cada página y endpoint de la checklist (sección 9), guardar/cargar un programa chico y uno de ~30 nodos, cortar energía durante el guardado, y comparar la salida del monitor contra el simulador con las mismas secuencias de entrada.
