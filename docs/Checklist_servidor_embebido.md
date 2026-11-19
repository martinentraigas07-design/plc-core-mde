# Checklist breve — servidor web embebido (navegador conectado al ESP32)

Conectar a `PLC_CORE_MDE` y abrir `http://192.168.4.1/`. Cargar los resultados (OK / falla / observación). **Todo está pendiente: no se probó en hardware.**

| # | Comprobación | Esperado | OK |
|---|---|---|---|
| 1 | Subir `firmware/data/` y anotar espacio: en el monitor serie, `SPIFFS.usedBytes()/totalBytes()` (agregar temporalmente) | usado ≈ 0,7 MB de ≈ 1,4 MB | ☐ |
| 2 | Abrir `/`, y navegar a Programar (FBD), Ladder, Monitor, Manual, Acerca de | Cargan sin 404; la consola del navegador (F12) sin errores rojos | ☐ |
| 3 | F12 → Network: ningún pedido a hosts externos (fuentes, CDN) | 0 pedidos externos | ☐ |
| 4 | `/ladder.html`: tiempo de carga y que cargue completo (118 KB + scripts) | < 10 s, sin cortes | ☐ |
| 5 | FBD: armar `IN1 → OUT1`, **Guardar** | Mensaje de guardado; `/plc/reload` OK | ☐ |
| 6 | Presionar IN1 real y ver OUT1 (LED/multímetro) y el Monitor | OUT1 sigue a IN1; Monitor coincide | ☐ |
| 7 | FBD marcha/paro: RS(S=IN1, R=NOT IN2) con paro NC | Retiene; el paro apaga | ☐ |
| 8 | Ladder: renglón X0 → SET Y0 y X1 → RESET Y0; **COMPILE** | Guarda; Y0 retiene y se resetea | ☐ |
| 9 | Recargar la página (F5) en FBD y en Ladder | Recupera el programa (`/load`) | ☐ |
| 10 | Abrir en Ladder un programa guardado desde FBD (convertible) | Se convierte con aviso "verificada" | ☐ |
| 11 | Abrir en Ladder un FBD no convertible (2 memorias en lazo) | Rechaza con motivo y **no sobrescribe** el programa del PLC | ☐ |
| 12 | Cortar energía y volver a encender | El programa corre solo; la web sigue accesible | ☐ |
| 13 | Monitor: observar 5 min | LEDs X/Y, AI1, nodos y modo RUN/STOP coherentes; sin errores; sin reinicios | ☐ |
| 14 | Botones RUN / STOP / RELOAD (monitor y editores) | Cambian el modo; las salidas se apagan en STOP | ☐ |
| 15 | Etiquetas (TAGS) en el editor: guardar y recargar | Se conservan (`/tags/get`, `/tags/save`) | ☐ |
| 16 | Panel Modbus del monitor: Discovery y estado | Responde sin bloquear el scan (esclavo de prueba si lo hay) | ☐ |
| 17 | Badge WiFi del monitor | Alterna el AP (se pierde la conexión: reconectar) | ☐ |
| 18 | Abrir 2 pestañas/dispositivos a la vez | Sigue respondiendo (el servidor atiende de a un pedido) | ☐ |
| 19 | Guardar un programa grande (≥ 30 nodos) y recargarlo | Guarda/carga; sin 500 ni reinicio; anotar heap libre | ☐ |
| 20 | Anotar: tamaño del sketch, RAM global usada, heap libre en marcha | — | ☐ |
| 21 | **.plc** — En la PC (sin Internet), abrir `simulator`/raíz `program.html`, cargar `examples/Control_Tanque_FBD.plc` con «Importar proyecto» | Se arma el diagrama (6 nodos); mensaje «La compilación coincide»; el simulador dice «PLC SIMULADO» | ☐ |
| 22 | Conectarse al WiFi del PLC, abrir `http://192.168.4.1/program.html` y «Importar proyecto» con el mismo archivo | Se arma el diagrama; el mensaje dice «Todavía NO está guardado en el PLC (ESP32)»; el programa que corría **no cambió** (verificar salidas) | ☐ |
| 23 | Presionar «Guardar en PLC» tras importar | Pide confirmación «REEMPLAZAR…». «Cancelar» no cambia nada; «Aceptar» guarda y recarga | ☐ |
| 24 | Con IN1 (nivel bajo) y IN2 (nivel alto) reales: bajo → OUT1 enciende y retiene; ~100 ms después OUT2; alto → apaga | Igual que el simulador | ☐ |
| 25 | Repetir 22–24 en `ladder.html` con `examples/Control_Tanque_Ladder.plc` (X0 SET Y0, X1 RESET Y0, Y0 → Y1) | Igual | ☐ |
| 26 | «Exportar proyecto» desde el ESP (FBD y Ladder), abrir el `.plc` en el simulador | Mismo diagrama y misma compilación | ☐ |
| 27 | Importar un `.plc` truncado/editado a mano (o un `.txt`) | Rechazo con motivo; editor y PLC sin cambios | ☐ |
| 28 | Importar un `.plc` FBD en Ladder (convertible) y un `.plc` Ladder en FBD | Ladder lo convierte con aviso; FBD indica abrirlo en Ladder; sin cambios en el PLC | ☐ |

Nota: en el ESP real el Monitor no muestra el tiempo transcurrido de timers ni métricas de scan (el firmware no las informa) y no permite forzar entradas.
