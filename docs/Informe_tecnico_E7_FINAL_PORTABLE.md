# Informe técnico — E7 FINAL: proyectos portables ".plc" (6.2.0-rc.1)

**Estado:** preparada para auditoría y pruebas físicas. **No compilada para ESP32 y no probada en hardware.** Sin cambios en firmware (`.ino`, runtime, pines, Modbus) ni en el motor de ejecución. Nada publicado en GitHub; sin tags ni releases. Base: E7 (servidor web embebido).

## 1. Qué se hizo
| Requisito | Resultado |
|---|---|
| Formato propio, versionado y portable | `.plc` = JSON `plc_project` v1 (`docs/Formato_proyecto_PLC.md`). Contenedor **externo**; el envelope `plc_program` del firmware y `/save` no cambian. |
| Contenido mínimo | Identificador y versión; nombre; editor de origen (`fbd`/`ladder`); diagrama editable completo; IR compilado (caché informativa); metadatos de compatibilidad (`compat`: destino, envelope 2/3, versión de IR, formato Ladder, máx. de nodos); tabla de símbolos; CRC-32. Sin estado de ejecución ni fechas (exportaciones reproducibles byte a byte). |
| Tres acciones en FBD y Ladder | **Guardar en PLC** (compila, valida y envía), **Exportar proyecto** (descarga `.plc`; no toca el PLC), **Importar proyecto** (lee → valida → confirma → reconstruye el editor). Nombre de proyecto editable; área de mensajes (ok/aviso/error). |
| Simulador sin simular hardware | El botón dice «Guardar en PLC (simulado)» y los mensajes «Enviado al PLC SIMULADO: no se guardó en ningún hardware». En el ESP: «guardado en el PLC». |
| Compatibilidad | Programas FBD y Ladder existentes, JSON Ladder anterior (`ladder-pro`, y también por «Importar proyecto»), formato de persistencia del firmware, conversiones FBD↔Ladder con sus rechazos: todo sin cambios (baterías previas intactas). |
| Seguridad de importación | Ver §3. Importar jamás envía a `/save`; el primer «Guardar en PLC» posterior exige confirmar. |
| Integración E7 | Funciona en la raíz (simulador) y en `firmware/data/`; `tools/build_web.js` incluye `plc_project.js` solo; sin Internet. |
| Ejemplos | `examples/Control_Tanque_FBD.plc` y `examples/Control_Tanque_Ladder.plc` (generados con los editores reales por `tools/make_examples.js`). |

## 2. Archivos
**Agregados:** `js/project/plc_project.js`, `examples/*` (2 `.plc` + README), `tools/make_examples.js`, `tests/t_e7_portable.js`, `tests/portable_lib.js`, `docs/Formato_proyecto_PLC.md`, este informe.
**Modificados:** `program.html` (botones, `buildFbdEnvelope()` separado de `saveProgram()`, exportar/importar, confirmación, mensajes), `ladder.html` (botones, `buildLadderEnvelope()` separado de `compileAndSend()`, exportar/importar, confirmación, mensajes; «COMPILE» → «Guardar en PLC», «IMPORT» → «IMPORT JSON»), `firmware/data/*` (regenerado: `program.html`, `ladder.html`, `+plc_project.js`, `build_info.json`), `tests/run_all.sh`, `tests/README.md`, `README.md`, `CHANGELOG.md`, `VERSION` (6.2.0-rc.1), `docs/Instrucciones_carga_ESP32.md`, `docs/Checklist_servidor_embebido.md` (+8 ítems, 21–28).
**Sin cambios:** firmware, hardware, simulador, compiladores, manual v3, licencias. **Eliminados:** ninguno.
La refactorización de `saveProgram`/`compileAndSend` solo separa la compilación/validación (sin efectos) del envío; los mensajes y el comportamiento previos se conservan (las baterías `t_ui`, `t_e4_protect`, `t_e7_web` siguen pasando sin tocarlas).

## 3. Seguridad de la importación
Orden: tamaño (antes de leer) → JSON → claves peligrosas/profundidad → identidad y versión → diagrama → IR → suma de verificación → resumen y **confirmación del usuario** → reconstrucción con respaldo (si falla, se restaura el diagrama previo).
- **IR del archivo nunca se envía al PLC.** Siempre se recompila el diagrama con el compilador de la página y se compara (`La compilación coincide…`).
- **No se ejecuta código del archivo.** Hallazgo: Drawflow inserta el `html` de cada nodo con `innerHTML`; un `.plc` hostil podría traer `<img onerror=…>`. El importador solo acepta HTML de una **lista blanca** (div/br/select/option/input; atributos `style/class/value/type=number/df-*`) y **rechaza** el archivo si encuentra otra cosa (no lo "limpia"). Probado con 15 variantes hostiles y con el flujo completo (incluso con la suma de verificación recalculada por el atacante): `window.__pwn` queda indefinido. Los comentarios Ladder con HTML se importan como texto (no se crea ningún `<img>`). Los datos de nodo solo llegan a `.value`/`.innerText` de Drawflow (revisado en `drawflow.min.js`).
- Límites: 256 KiB, 64 nodos (el firmware ignoraría los sobrantes en silencio; aquí se rechaza), 128 renglones, profundidad 40. Claves `__proto__/constructor/prototype` rechazadas; `Object.prototype` verificado intacto.
- Límite reconocido: el CRC-32 detecta corrupción, **no** es una firma; la seguridad no depende de él.

## 4. Resultados de pruebas (PC; ver `docs/resultados_E7_final_run_all.txt`)
`tests/run_all.sh` → **33 baterías, 0 FAIL** (las 32 anteriores + `t_e7_portable`, 140 comprobaciones). `t_e7_portable` cubre, entre otros:
- Exportación FBD→`.plc`→importación FBD y Ladder→`.plc`→Ladder, en las **4 combinaciones** simulador/ESP simulado → simulador/ESP simulado (diagrama idéntico: nodos, nombres, conexiones, parámetros, posiciones; renglones, direcciones y comentarios).
- Compilación equivalente antes/después (mismo IR nodo por nodo) y programas importados que corren igual en el **firmware real compilado en el host** y en el simulador (tanque: `1000,1100,1100,0000` FBD; `1100,1100,1100,0000` Ladder).
- 32 rechazos de archivos (vacío, no JSON, truncado, formato futuro, suma alterada, demasiado grande, >64 nodos, tipo desconocido, conexión a nodo inexistente, `typenode`, `class` con comillas, `__proto__`, variable maliciosa, >128 renglones, anidamiento…), más 7 casos por la interfaz real: editor sin cambios, 0 `/save`, programa del PLC intacto, sin confirmación pedida.
- Sin sobrescritura automática: importar → 0 `/save`; guardar tras importar pide confirmar; si se rechaza, el PLC queda intacto; guardado normal (sin importar) no pide confirmación.
- JSON Ladder anterior, envelopes guardados en el PLC, cruce de editores (FBD→Ladder convertible/no convertible; Ladder→FBD rechazado).
- Corpus real: 75 programas FBD del manual y 69 convertidos a Ladder, sin falsos rechazos. Los 24 tipos de nodo de `editor.js` y el HTML de `irToDrawflow` pasan la lista blanca.
- Descarga real (`Blob` + `<a download>`) y rechazo de archivo enorme antes de leerlo.
- **Verificación de las pruebas (mutaciones):** quitar la confirmación al guardar, anular la suma de verificación, anular la lista blanca de HTML y forzar un guardado automático al importar hicieron fallar `t_e7_portable` (8, 5, 3 y 16 fallos respectivamente).
- `firmware/data/` sincronizada (`build_web.js --check`) y ejemplos reproducibles (`make_examples.js --check`).

## 5. Tamaño y SPIFFS
`firmware/data/`: 22 archivos, **697 890 B (681,5 KiB)**, antes 660 015 B (21 archivos): **+37 875 B** (`plc_project.js` 22 421; `ladder.html` +8 800; `program.html` +6 654). SPIFFS estimado (páginas de 256 B) **725 248 B = 48 %** de la partición por defecto (1 507 328 B); libres ≈ 782 000 B (antes 45 % / 822 000 B). Sigue habiendo margen para el programa (≈80 KB) y su `.tmp` transaccional. El `.plc` **no se guarda en el ESP32**: vive en la PC del usuario, así que no consume SPIFFS. Archivo ≠ RAM: las páginas se sirven con `streamFile`; lo que usa RAM es el cuerpo de `/save` (igual que antes). Un `.plc` típico: 3–5 KB (ejemplos); de 64 nodos, del orden de 80–100 KB (< 256 KiB).

## 6. Compilación para ESP32
**No realizada.** El entorno bloquea la descarga del toolchain (PlatformIO/arduino-cli; ver informes E6/E7). No se afirma que compile ni que no compile. En esta etapa no se modificó ningún `.cpp/.h/.ino`; solo cambió `firmware/data/`. Requisitos: core Arduino-ESP32 2.x, ArduinoJson 6.x, ESP32 Dev Module.

## 7. Limitaciones y riesgos
1. **Sin validar en hardware** (SPIFFS con los 22 archivos, WiFi, rendimiento del `WebServer` con `ladder.html` de 127 KB). Reponer la interfaz exige **volver a subir SPIFFS** (borra `/program.json`: hacer copia con «Exportar proyecto» antes).
2. Las etiquetas de IO (TAGS) no van en el `.plc`.
3. El `.plc` FBD se abre en Ladder solo si es convertible; `.plc` Ladder no se abre en FBD (se indica abrirlo en Ladder).
4. La confirmación usa `confirm()` del navegador; es un diálogo bloqueante estándar (en navegadores que los inhiben, la importación/guardado tras importar quedaría cancelado: falla seguro).
5. Archivos `.plc` de versiones futuras (`formatVersion` > 1) se rechazan.
6. La lista blanca de HTML puede rechazar un `.plc` FBD legítimo si en el futuro se agregan bloques con HTML nuevo: hay que actualizar `plc_project.js` junto con `editor.js` (la prueba A6/C0 lo detecta: compara contra los 24 tipos reales).
7. CRC-32 no es una firma; el sistema de red del AP sigue sin autenticación (preexistente).
8. Validación diferencial en PC, no formal.

## 8. Qué sigue
Auditoría independiente (ChatGPT) y pruebas físicas con `docs/Checklist_servidor_embebido.md` (ítems 1–28) y `docs/Checklist_pruebas_fisicas.md`. Publicación en GitHub: la hará ChatGPT tras la aprobación; aquí no se publicó nada.
