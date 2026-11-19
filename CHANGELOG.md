# CHANGELOG — PLC-CORE-MDE

Versión propuesta: **6.2.0-rc.1** (candidata; falta validación en hardware). No se creó ningún tag ni release.
Base de comparación: la versión original recibida al iniciar la auditoría (firmware `.ino` "v5").

## [6.2.0-rc.1] — Etapa E7 FINAL (proyectos portables ".plc")
### Agregado
- **Formato de proyecto `.plc`** (`plc_project`, versión 1): JSON versionado y portable con el diagrama editable (FBD o Ladder), el IR compilado como caché informativa, metadatos de compatibilidad y suma de verificación CRC-32. Es un contenedor **externo**: el formato interno del firmware (`/save`, envelope `plc_program`) no cambia. No es PLCopen XML ni IEC 61131-10. Especificación: `docs/Formato_proyecto_PLC.md`.
- `js/project/plc_project.js`: construcción, serialización y validación estricta (límites de tamaño/nodos/renglones, lista blanca de tipos y del HTML de nodos FBD, claves peligrosas, suma de verificación). No usa `eval`, `Function` ni `innerHTML`.
- Editores FBD y Ladder: **Guardar en PLC** (compilar, validar y enviar), **Exportar proyecto** (descarga `.plc`, sin tocar el PLC) e **Importar proyecto** (leer → validar → confirmar → reconstruir el editor). Importar nunca guarda en el PLC: el primer «Guardar en PLC» posterior pide confirmación explícita. En el simulador los mensajes y el botón aclaran que es un PLC **simulado**, no hardware.
- `ladder.html`: `buildLadderEnvelope()` separa la compilación/validación (sin efectos) del envío; `compileAndSend()` conserva el mismo comportamiento. `program.html`: `buildFbdEnvelope()` equivalente para FBD.
- Importación de formatos anteriores: JSON Ladder (`ladder-pro`) y envelopes `plc_program` guardados en el PLC entran por «Importar proyecto» (con advertencia). El export/import JSON Ladder anterior sigue funcionando.
- `examples/Control_Tanque_FBD.plc`, `examples/Control_Tanque_Ladder.plc` (+ `examples/README.md`) y `tools/make_examples.js` (los regenera/verifica con los editores reales).
- `tests/t_e7_portable.js` (+ `tests/portable_lib.js`): ida y vuelta FBD y Ladder entre simulador y servidor embebido (4 combinaciones), compilación equivalente, rechazo de archivos corruptos/incompatibles/enormes/hostiles, protección del programa anterior, sin sobrescritura automática, JSON Ladder anterior, ejecución de lo importado en el firmware real y en el simulador, sincronización de `firmware/data/`.
- `tools/build_web.js` incluye automáticamente `plc_project.js` (22 archivos; +37,9 KB; SPIFFS estimado 48 %).
### Sin cambios
- Firmware (`.ino`, runtime, pines, Modbus), motor de ejecución, diseño eléctrico, manual v3, licencia.

## [6.1.0-rc.1] — Etapa E7 (servidor web embebido completo)
### Agregado
- `tools/build_web.js`: construcción reproducible de `firmware/data/` desde la raíz (sin simulador; rutas aplanadas para SPIFFS; sin Google Fonts; solo recursos referenciados; `--check` para CI). `firmware/data/build_info.json` con tamaños y hashes.
- `js/api/plc_api_esp.js`: adaptador que arma el objeto `/api/memory` desde `/status` + `/nodes` (el firmware no implementa `/api/memory`); mismo mapeo que el simulador.
- `firmware/data/` ahora incluye FBD, **Ladder v4**, monitor, manual, compiladores/decompilador e `ir_check` (≈0,66 MB, 21 archivos). La interfaz anterior se conserva en `web_legacy_E6/`.
- `monitor.html`: badge/botón WiFi (`/wifi/toggle`) de la interfaz embebida anterior (función que no existía en la versión de la raíz).
- `tests/t_e7_web.js` + `tests/esp_mock.js` (ESP32 simulado con las respuestas del firmware): recursos, dependencias, rutas, sin Internet, guardado/carga FBD y Ladder, ejecución del programa guardado en el firmware real compilado en el host.
- `docs/Instrucciones_carga_ESP32.md`, `docs/Checklist_servidor_embebido.md`, `docs/Informe_tecnico_E7.md`.
### Corregido
- `js/compiler/symbol_table.js` (`validate`): comparaba `in1/in2` (índices) con `node.id` y bloqueaba el guardado FBD con un `SELF_LOOP` falso (p. ej. un RS de id 3 alimentado por un NOT creado después, de id 4). Ahora compara con el índice; la autorreferencia real se sigue detectando.
### Sin cambios
- Firmware (`.ino`, runtime, pines, Modbus), diseño eléctrico, manual v3, licencia.

## [6.0.0-rc.1] — Etapa E6 (preparación de entrega)

### Agregado
- `tests/t_e6_audit.js`: auditoría estática (referencias locales de las páginas, sintaxis JS y scripts inline, endpoints usados vs. rutas del firmware, includes del firmware, ruta única de compilación/envío).
- `README.md` reescrito con tabla "implementado vs. previsto" y estado de validación; `CHANGELOG.md`, `VERSION`.
- `manual.html` y `firmware/data/manual.html` (manual en línea): se corrigió la regla falsa "R_TRIG antes del CTU" y el esquema del ciclo de scan (solo texto).
- `docs/`: Manual didáctico v3 (PDF), informe E5, informe técnico E6, checklist de pruebas físicas.

## Etapa E5 — Manual didáctico v3
- Nuevo `docs/Manual_PLC_CORE_MDE_COMPLETO_v3.pdf` (el v2 no se modificó); scripts de reconstrucción en `docs/build_manual/`.
- Corregido el modelo de evaluación descrito (el "snapshot IEC 61131-3" era falso) y la regla "siempre R_TRIG antes del CTU" (CTU/CTD cuentan solo flancos).
- Ejemplos de marcha/paro con paro NC reescritos con `RS(S=arranque, R=NOT paro)`; SCALE con truncamiento hacia cero; PWM 5 kHz/12 bit; CTD con CV=0 al arrancar.
- Capítulos 7 y 8 rotulados como ejercicios didácticos (no seguridad certificada); Capítulo 9 y nodos RDI/RDO/RAI/RAO marcados como conceptuales (no existen en el editor).
- Nuevos Apéndices B (limitaciones y ejercicios no convertibles) y C (registro de cambios). Prueba: `tests/t_e5_manual.js`.

## Etapas E1–E4c — Ladder, conversión, compiladores
- **Compilador (`js/compiler/compiler.js`):** orden de ejecución determinista (igual al del firmware); conexiones resueltas por puerto; variables numéricas Ladder v4; idioma SR(S=X, R=NOT X) tratado como RS (corrección E4b).
- **Verificador IR (`js/compiler/ir_check.js`, nuevo):** oráculo diferencial, validado contra firmware (host) y simulador.
- **Ladder (`ladder_program.js`, `ladder_ast.js`, `ladder_decompiler.js`):** soporte de flancos [P]/[N], CMP, BLINK, AI1/SCALE/PWM, reset de CTU, carga de CTD, bloques reutilizables y XOR expandido; migración de programas de versiones anteriores; validación de renglones; rechazo explícito (con motivo) de lo no convertible: lazos combinacionales, lazos con 2 o más memorias (dependen de los ID internos), entradas sin conectar, etc. Lazos con una sola memoria se admiten y se revalidan.
- **`ladder.html`:** única ruta de compilación (`compileLadder`; se eliminó la caída a `compileLadderAST`, que daba resultados distintos en casos límite); un archivo dañado o una conversión rechazada no sobrescriben el programa abierto, el borrador ni el persistido.
- **Conversión FBD → Ladder → FBD:** probada de forma diferencial (firmware compilado en el host vs. simulador, más el oráculo IR) sobre los programas del manual, un corpus por característica y programas aleatorios. No es una prueba formal de equivalencia.

## Corrección del motor y firmware (Etapas 1–2)
- **`firmware/plc_runtime.cpp` (runtime v6):** cada nodo se evalúa una vez por scan en orden de dependencias (Kahn, desempate por menor ID); los lazos se cortan en el bloque con memoria de menor ID; puertos de entrada por conexión (ya no dependen del orden de los ID); AI1 y SCALE propagan valor entero; SCALE con aritmética entera truncando hacia cero; carga transaccional del programa y capacidades de documento JSON escalonadas.
- **Persistencia (`web_server.cpp`, `storage.cpp`, `plc_control.cpp`):** guardado transaccional (`/program.tmp` + renombrado), recuperación si se cortó la energía entre el borrado y el renombrado, `/load` por `streamFile` (sin copiar el programa a RAM), el programa anterior permanece si el nuevo es inválido o no entra en memoria; el log de arranque ya no vuelca el JSON completo.
- **Simulador (`simulator/plc_sim_runtime.js` v3):** espejo del runtime v6 (mismo orden, puertos, SCALE entero, corte de lazos, carga transaccional).
- **No se modificaron** pines, hardware, comunicación Modbus ni licencia.

## Conocido / sin cambios
- El maestro Modbus existe a nivel de driver; no hay nodos Modbus en editor/compilador/runtime.
- Sin validación en hardware ESP32 (ver `docs/Checklist_pruebas_fisicas.md`).
