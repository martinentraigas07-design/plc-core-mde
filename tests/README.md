# Pruebas del PLC-CORE-MDE (host)

Todo lo de esta carpeta corre en una PC (Linux + Node + g++). **No son pruebas del ESP32.**

- `hostfw/` compila el `firmware/plc_runtime.cpp` real con shims de Arduino y lo ejecuta programa por programa.
- `harness.js` corre el mismo programa Drawflow en ese firmware compilado y en `simulator/*.js`, y compara las salidas.
- `t_*.js`: motor determinista, puertos, SCALE, interlocks, compiladores FBD/Ladder, conversión, persistencia.
- `manual/`: ejemplos del manual v2 traducidos a programas ejecutables (`ch01_03.js` … `ch11_5box.js`); cada hallazgo queda escrito en el propio test y en `manual/resultados/`.

Requisitos: Node.js, g++ (C++17), ArduinoJson 6.x y jsdom (`cd tests && npm install`; se busca en `tests/node_modules/jsdom` o en la variable `JSDOM_PATH`).

Ejecutar todo: `ARDUINOJSON=/ruta/a/ArduinoJson/src ./tests/run_all.sh` (ArduinoJson 6.x, la misma versión que usa el firmware).

Pendiente de verificar en hardware (no cubierto aquí): ADC, PWM LEDC, RS-485/Modbus, SPIFFS (guardado transaccional, recuperación, streamFile), heap real y tamaño real de slot, tiempos reales.

- `t_e6_audit.js`: auditoría estática (referencias, sintaxis, endpoints vs. rutas del firmware, includes, ruta única de compilación/envío).
- `t_e7_web.js` (+ `esp_mock.js`): interfaz embebida (`firmware/data/`) contra un ESP32 simulado a nivel HTTP; no prueba el ESP32 físico.
- `t_e7_portable.js` (+ `portable_lib.js`): proyectos `.plc` — exportar/importar FBD y Ladder entre simulador y servidor embebido, validación/rechazos, protección del programa anterior; ejecuta lo importado en el firmware compilado en el host. No prueba el ESP32 físico.
