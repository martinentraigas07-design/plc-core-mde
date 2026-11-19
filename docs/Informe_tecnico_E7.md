# Informe técnico — Etapa E7: servidor web embebido completo (6.1.0-rc.1)

**Estado:** preparada para validación. **No compilada para ESP32 y no probada en hardware.** Sin cambios en el firmware (`.ino`, runtime, pines, Modbus). Nada publicado en GitHub; sin tags ni releases.

## 1. Diagnóstico (antes de modificar)
| Hallazgo | Consecuencia |
|---|---|
| `firmware/data/` era la UI FBD original (351 KB): sin Ladder, sin `js/` (compiladores, decompilador, IR, tabla de símbolos). | El ESP32 no podía servir Ladder v4 ni compilar con el compilador actual. |
| Las páginas de la raíz cargan siempre `simulator/*.js`, que **intercepta `fetch`** y responde con un PLC simulado. | Copiadas tal cual al ESP32, nunca hablarían con el PLC real. |
| Las páginas de la raíz usan **`/api/memory`** (monitor, panel de memoria y energización en Ladder). **El firmware no la implementa** (solo `/status`, `/nodes`, `/save`, `/load`, `/plc/*`, `/tags/*`, `/modbus/*`, `/wifi/*`, `/io/map`, `/manual`). | El Monitor nuevo y la animación de Ladder habrían dado 404 en el ESP32. (La verificación estática de E6 no lo detectó: `PlcApi` llama `_get('/api/memory')`, no `fetch(...)`.) |
| SPIFFS (arduino-esp32) limita el nombre completo a **31 caracteres** y no tiene directorios. | `/js/compiler/ladder_decompiler.js` (34) no se podría crear. |
| `style.css`, `index.html` y `about.html` importan **Google Fonts**. | Dependencia de Internet (sin red cae a `sans-serif`/`monospace`). |
| Las páginas de la raíz y de `firmware/data/` diferían (distintas versiones); el monitor embebido tenía un badge/toggle WiFi que el de la raíz no tenía. | Riesgo de perder una función al unificar. |
| `symbol_table.validate` comparaba `in1/in2` (índices del IR) con `node.id`. | **Defecto previo**: bloqueaba el guardado FBD con "SELF_LOOP" falso (p. ej. RS id 3 alimentado por un NOT de id 4). Aparece al guardar desde `program.html` (también en la versión de la raíz). |
| Recursos externos (imágenes, fuentes, CDN): solo las fuentes; las imágenes van embebidas en base64. | Nada más que resolver. |

## 2. Solución implementada
- **Fuente única de código:** las páginas y `js/` de la raíz. `firmware/data/` pasó a ser **salida generada** por `node tools/build_web.js` (reproducible; `--check` falla si difiere). Transformaciones: quita el simulador; inyecta `plc_api_esp.js` tras `plc_api.js`; aplana rutas; elimina `@import` de fuentes; copia solo recursos referenciados + `LICENSE.txt`; valida nombres ≤ 31 y referencias; escribe `build_info.json` (tamaños y hashes, sin fecha). Una mejora futura de FBD/Ladder se incorpora con un solo comando.
- **Adaptador `js/api/plc_api_esp.js`:** reemplaza `getStatus/getNodes/getMemory` con caché de 250 ms y arma `{X,Y,M,T,C,R,A}` desde `/status` y `/nodes` con el **mismo mapeo** que el simulador (`id % tamaño`; CV en `(id+16) % 32`). `patchMemory/toggleInput` se rechazan (no se pueden forzar entradas físicas). El firmware no cambia.
- **`monitor.html`:** se incorporó el badge/botón WiFi (`/wifi/toggle`) de la UI anterior (también funciona en el simulador).
- **`symbol_table.js`:** compara con el índice. La autorreferencia real se sigue detectando (tests B4/B5).
- **Interfaz anterior conservada** en `web_legacy_E6/` (fuera del sketch, no se sube a SPIFFS). No se eliminó ningún archivo original.
- **Simulador:** sin cambios; sigue siendo aplicación independiente (raíz + `simulator/`).

Funciones requeridas y su origen en el ESP32: principal/navegación (`index.html`), FBD (`program.html`), Ladder v4 (`ladder.html`), conversión FBD↔Ladder (`ladder.html` + `ladder_decompiler.js`; con las limitaciones documentadas), monitor, abrir/guardar/cargar/ejecutar (`/save`, `/load`, `/plc/*`), configuración/etiquetas (TAGS en el editor FBD), panel Modbus (en el monitor), manual (`manual.html`, ruta `/manual`) y "Acerca de".

## 3. Archivos modificados / agregados
**Agregados:** `tools/build_web.js`, `js/api/plc_api_esp.js`, `firmware/data/*` (21 archivos generados), `web_legacy_E6/`, `tests/t_e7_web.js`, `tests/esp_mock.js`, `docs/Instrucciones_carga_ESP32.md`, `docs/Checklist_servidor_embebido.md`, `docs/Informe_tecnico_E7.md`.
**Modificados:** `monitor.html` (badge WiFi), `js/compiler/symbol_table.js` (validación), `tests/run_all.sh`, `tests/t_e6_audit.js` (el apartado informativo de empaquetado), `tests/README.md`, `README.md`, `CHANGELOG.md`, `VERSION`.
**Sin cambios:** `firmware/*.ino/.cpp/.h`, hardware, licencias, manual v3, simulador, resto del proyecto.
**Eliminados:** ninguno (`firmware/data` anterior → `web_legacy_E6/firmware_data_E6/`).

## 4. Tamaño y SPIFFS
Archivos servidos (21): total **660 015 B (644,5 KiB)**.
| Archivo | B | | Archivo | B |
|---|---:|---|---|---:|
| ladder.html | 118 093 | | ladder_ast.js | 26 468 |
| program.html | 81 712 | | symbol_table.js | 13 818 |
| manual.html | 74 294 | | ir_check.js | 10 736 |
| index.html | 63 785 | | about.html | 8 464 |
| compiler.js | 57 653 | | memory_panel.js | 7 011 |
| drawflow.min.js | 46 190 | | style.css | 6 967 |
| monitor.html | 45 399 | | editor.js | 6 464 |
| ladder_decompiler.js | 41 261 | | LICENSE.txt | 6 428 |
| ladder_program.js | 37 931 | | plc_api_esp.js / drawflow.min.css / plc_api.js / build_info.json | 3 592 / 1 910 / 1 839 / ≈2,6 K |

- **Indispensables:** todo lo anterior salvo `about.html`, `manual.html`, `LICENSE.txt` y `build_info.json` (opcionales, ≈ 92 KB). **Duplicados:** no hay en `data/`; sí logos en base64 repetidos dentro de `index/program/manual` (≈ 30 KB cada vez, se podrían extraer a un archivo). **Dependencias externas:** ninguna.
- **Partición por defecto** (*Default 4MB with spiffs*): 1 507 328 B. Estimación conservadora de ocupación (páginas SPIFFS de 256 B): **≈ 686 KB = 45 %**; libres ≈ 822 KB. Un programa guardado puede llegar a ≈ 77 KB y el guardado transaccional necesita archivo + `.tmp` (≈ 154 KB): hay margen. La estimación **debe medirse** con `SPIFFS.usedBytes()`.
- **Compresión/minificación (no implementada):** gzip de todo el conjunto ≈ 229 KB (35 %). No se implementó porque requeriría verificar en el ESP real el encabezado `Content-Encoding` que agrega `WebServer::streamFile` (riesgo de duplicarlo) y no es necesaria para entrar. Queda como mejora si hiciera falta espacio o velocidad.
- **Esquema recomendado:** el *Default 4MB with spiffs* alcanza para la web. Si el firmware compilado no entrara en 1,2 MB de APP, usar *No OTA (2MB APP/2MB SPIFFS)*. No usar *Minimal SPIFFS* (190 KB).
- **Archivos ≠ RAM:** los archivos se sirven con `streamFile` (buffer pequeño, no se cargan enteros en RAM). La RAM relevante es el cuerpo de `/save` y el documento ArduinoJson al cargar (capacidades escalonadas ya existentes) — ver riesgos.

## 5. Compatibilidad con el firmware
FBD y Ladder envían por la misma `PlcApi.saveProgram` a `/save` (ya verificado en E6); `t_e7_web.js` lo ejecuta con las páginas embebidas: el envelope guardado desde `program.html` y desde `ladder.html` se ejecuta en el **mismo firmware real compilado en el host** con el comportamiento esperado, se recupera desde `/load`, el formato antiguo (solo `drawflow`) se abre, y un FBD no convertible **no** es sobrescrito por Ladder. El runtime, los pines y Modbus no cambiaron.

## 6. Pruebas (PC)
`tests/run_all.sh` → **32 baterías, 0 FAIL** (las 31 de E6 + `t_e7_web`, 40 comprobaciones; `t_e6_audit` 146). Ver `docs/resultados_E7_run_all.txt`. `t_e7_web` cubre: existencia de recursos, nombres ≤ 31, referencias locales, ausencia del simulador, **ausencia de dependencias de Internet**, rutas HTTP contra el `.ino`, tamaño/espacio, adaptador, y integración FBD/Ladder/Monitor en jsdom contra un ESP simulado (`esp_mock.js`, con las respuestas del firmware).
Límites: el ESP simulado **no** reproduce SPIFFS, WiFi, `WebServer` (un pedido a la vez, 503 por mutex), ni temporización real.

## 7. Compilación para ESP32
**No realizada.** Intenté instalar PlatformIO (`pip` sí funcionó) y la plataforma `espressif32@6.5.0` (= Arduino-ESP32 2.0.14); el registro de PlatformIO no es accesible desde este entorno (`HTTPClientError`). En E6 el entorno ya había bloqueado la descarga de arduino-cli/core. **No se afirma que compile ni que no compile.** Como en E7 no se modificó ningún `.cpp/.h/.ino`, el estado de compilación respecto de E6 no cambió. Core obligatorio: 2.x (por `ledcSetup/ledcAttachPin`) y ArduinoJson 6.x.

## 8. Limitaciones y riesgos pendientes
1. **Sin validar en hardware** (SPIFFS, WiFi, rendimiento del `WebServer` con páginas de 118 KB, 2 clientes simultáneos).
2. Monitor en el ESP: sin tiempo transcurrido de timers ni métricas de scan (el firmware no las expone) y sin forzado de entradas; cada refresco hace 2 pedidos (`/status` + `/nodes`, con caché de 250 ms). `/nodes` puede responder 503 si el mutex está ocupado (la UI lo muestra como error de polling).
3. La energización en vivo de Ladder para flancos/CMP no se muestra (limitación previa documentada en `ladder.html`).
4. Memoria: un envelope grande (~77 KB) y la capacidad del documento ArduinoJson dependen del heap real; medir.
5. Nombres planos: si el proyecto agrega recursos con el mismo nombre en distintas carpetas, `build_web.js` falla (por diseño) en lugar de pisar.
6. AP con clave fija `12345678` y endpoints sin autenticación (preexistente).
7. El badge WiFi apaga el AP (preexistente): se pierde la conexión hasta reencender con el botón físico SW1.
8. Subir SPIFFS borra el programa guardado: hacer copia antes.
9. Sin Internet: las tipografías caen a `sans-serif/monospace`; el aspecto cambia levemente.
