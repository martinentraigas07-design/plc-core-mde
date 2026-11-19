# Informe E5 — Manual didáctico v3

**Entregable:** `docs/Manual_PLC_CORE_MDE_COMPLETO_v3.pdf` (109 págs.). El v2 no se modificó (mismo tamaño y fecha).
**Cambios en el repo:** `tests/run_all.sh` (+ `t_e5_manual`), `tests/t_e5_manual.js`, el PDF v3 y `docs/build_manual/` (scripts de reconstrucción). Nada de firmware, motor, pines ni Modbus.

## Cómo se hizo
Se extrajo el contenido del v2 (1057 bloques), se re-renderizó fiel (97 págs., faltan 42 de 29888 palabras) y se aplicaron 206 parches por bloque. Los ejemplos corregidos se ejecutaron sobre el firmware compilado en PC y el simulador real (`t_e5_manual`, 34 comprobaciones). Batería completa: 30 baterías, 0 FAIL.

## Correcciones principales
- Falso "snapshot IEC 61131-3": reemplazado por el modelo real (orden de dependencias, corte de lazo en la memoria de menor ID).
- Regla "siempre R_TRIG antes del CTU": falsa; CTU/CTD cuentan solo flanco. El R_TRIG es redundante; el toggle sí lo necesita (oscila a ~50 Hz sin él, no 100 Hz).
- Marcha/paro: paro NC con `RS(S=arranque, R=NOT paro)` (reset dominante); terminal R admite una sola conexión (se usa OR).
- Compatibilidad Ladder: se eliminaron los "Level 1/2/3"; BLINK, CMP, AI1, SCALE, PWM y flancos son convertibles; XOR se expande.
- SCALE trunca hacia cero: se recomienda escalar a décimas y comparar con enteros (umbral 40 °C → ADC ≥ 3358).
- CTD arranca con CV=0, Q=1 hasta LD. PWM: 5 kHz, 12 bit; se distingue valor lógico / duty / pin físico.
- Cap. 7 y 8: marcados como ejercicios didácticos, no aplicaciones de seguridad; se retiró "categoría 1".
- Cap. 9 y RDI/RDO/RAI/RAO: marcados conceptuales (el maestro existe en el driver, pero no hay nodos en editor/compilador/runtime).
- Nuevos: Nota de revisión (inicio), Apéndice B (limitaciones) y Apéndice C (registro de cambios).

## Ejercicios no convertibles a Ladder (explicados en el Apéndice B)
| Ejercicio | Motivo |
|---|---|
| 2.4 Enclavamiento mutuo (RS+SR) | 2 memorias en el lazo; ganador depende de los ID |
| 8.3 Alarma enclavada (TON+RS±SR) | 2 memorias en el lazo |
| 10.5 Sistema completo | 6 memorias en el lazo |
| Versiones originales 7.4 y 10.x | AND con entrada sin conectar / flanco sin entrada (el compilador las rechaza); reemplazadas |

Convertibles con un lazo de una sola memoria: 2.2 (toggle), 3.4, 5.5, caja 11.

## Registro de cambios
| Cap. | Ejemplo | Tipo | Cambio |
|---|---|---|---|
| Portada | — | Agregado | Nota de revisión v3, alcance de las pruebas, convención NA/NC y aclaración "ejercicio didáctico ≠ función de seguridad". |
| Introducción | — | Eliminado | Se eliminó la introducción duplicada de la página 3 (idéntica en contenido a la de la página 4, que es la versión completa). |
| Introducción | Tabla de bloques | Corregido | AI1, CMP, BLINK, SCALE y PWM figuraban como "no convertible/aproximado": el decompilador actual los convierte (filas numéricas, comparador, BLINK). XOR se expande. Se agregó el recuadro de limitaciones reales. |
| Introducción | Ciclo de scan | Corregido | Se eliminó la afirmación falsa "snapshot IEC 61131-3: todos los bloques leen el ciclo anterior"; se describe el modelo real (orden de dependencias + corte del lazo en el bloque con memoria de menor ID). Tabla de fases rehecha según plcScan(). |
| Cap. 2 | 2.1 | Corregido | FBD: faltaba NOT entre el paro NC y R; se cambia SR por RS (reset dominante) para que el paro y el cable cortado ganen siempre. Ladder y tabla de estados rehechos; la tabla sale de la ejecución firmware==simulador. |
| Cap. 2 | 2.2 | Corregido | Recuadro de realimentación: se reemplaza el modelo "snapshot" por el modelo real (corte del lazo en el bloque con memoria). |
| Cap. 2 | 2.3 | Corregido | Cadena NC separada del pulsador de inicio y conectada a R (RS con R=NOT IN1): abrir la cadena detiene la máquina en marcha y no rearma sola. Tabla ejecutada. Rotulado como ejercicio didáctico, no función de seguridad. |
| Cap. 2 | 2.4 | Documentado | Se declara que con arranque simultáneo el ganador es indefinido por diseño y que el programa no es convertible a Ladder (2 memorias en el lazo). Corresponde al caso ch01_03#10 del banco de pruebas. |
| Cap. 2 | Referencia Ladder | Corregido | Los "Level 1/2/3" estaban desactualizados: BLINK, CMP, AI1, SCALE y PWM sí se convierten; XOR se expande; la lista de lo que no se convierte se reescribió según el decompilador real. |
| Cap. 3 | 3.1 | Corregido | FBD: NOT entre el paro NC y R. Ladder: rung de SET solo con IN1 (set dominante). La tabla de estados del original coincidía con el comportamiento corregido. |
| Cap. 3 | 3.2 | Corregido | FBD: NOT entre el paro NC y R. Ladder simplificado a SET (IN1) / RESET (/IN2) con dominancia de Reset. El título del ejemplo se normalizó. |
| Cap. 3 | 3.3 | Corregido | Se retiró la afirmación "BLINK Level 2 no se convierte perfectamente": el decompilador convierte BLINK. |
| Cap. 3 | 3.5 | Corregido | Cadena NC sola en IN1 conectada a R (NOT); rearme NA en IN2 conectado a S. Se quitó el FBD "simplificado" incorrecto. |
| Cap. 4 | 4.4 | Corregido | BLINK ya no figura como "Level 2 / aproximado": el decompilador lo convierte como bloque oscilador. |
| Cap. 4 | 4.6 | Corregido | SR→RS (reset dominante) para que el operario o el nivel alto puedan detener la bomba aunque IN1 siga activo; Ladder y tabla de estados ejecutada. |
| Cap. 5 | Regla R_TRIG | Corregido | Se eliminó la regla falsa "siempre R_TRIG antes del CTU" (CTU/CTD cuentan solo en flanco ascendente); verificado por ejecución con CTU conectado directo al sensor. |
| Cap. 5 | 5.2 | Aclarado | El motor debe ir a otra salida (OUT3); el FBD original usaba OUT1 para dos funciones. |
| Cap. 5 | 5.3 | Aclarado | CTD: CV=0 y Q=1 al encender hasta que se aplique LD. |
| Cap. 5 | 5.5 | Corregido | Se agregó el OR en el R del CTU_1 (un terminal R admite una sola conexión) y se reemplazó la explicación "snapshot" por la del corte del lazo. Convertible a Ladder (caso ch05#6). |
| Cap. 6 | Recuadro SCALE | Corregido | Se retiró "SCALE incompatible con Ladder (Level 3)"; se agregó el aviso de truncamiento hacia cero y la forma de ganar resolución. |
| Cap. 6 | 6.1 | Corregido | Cableado de la carga PWM: COM_OUT va siempre al 0V (el original lo conectaba al +24V, contra la regla del propio manual). Frecuencia PWM: 5 kHz (el original decía ~1 kHz), según plc_io.cpp. |
| Cap. 6 | 6.1 / PWM | Documentado | Diferencia entre valor lógico, duty y estado físico del pin; PWM nunca se describe como salida digital fija; qué se verificó y qué no. |
| Cap. 6 | 6.2 | Corregido | Umbrales por truncamiento del SCALE: CMP>25 recién actúa a ≥26 °C; el valor "1474 = 18 °C" se leía como 17. Se documenta y se propone SCALE 0–500 (décimas). |
| Cap. 6 | 6.4 | Corregido | SCALE 0–100 (décimas de kg) con CMP<20 y CMP>50; la tabla se recalculó con la aritmética del SCALE (valores calculados, no medidos). Antes 5,5 y 5,99 kg pasaban como BUENAS. |
| Cap. 6 | Resumen | Corregido | La tabla de compatibilidad Ladder del resumen ya no marca AI1/SCALE/CMP/PWM como "Level 3 no convertible". |
| Cap. 7 | 7.1 | Corregido | RS con R=NOT IN2 (el paro NC estaba conectado directo a R); Ladder y tabla de estados ejecutada. |
| Cap. 7 | 7.2 | Corregido | RS con NOT en el paro NC; K2 = Q_RS·NOT Q_TON (antes quedaba energizado con el motor parado); tiempo muerto de 100 ms entre K2 y K3; Ladder y tabla ejecutada. |
| Cap. 7 | 7.3 | Corregido | TON de 3 s alimentado por Q del TP (no por IN1) y AND con Q_TP para que el verde peatón dure hasta el fin del rojo; tabla ejecutada. |
| Cap. 7 | 7.4 | Adaptado | Sensores y reset compartían IN1/IN2 (el reset no actuaba) y la variante RS-485 usaba RDI inexistentes. Se reformula con lazo NC en IN1 y reconocimiento en IN2 (SR + BLINK). Se pierde la distinción de zonas (2 entradas). Tabla ejecutada. |
| Cap. 7 | 7.5 | Corregido | Tabla: la fila 55–50 °C (bajando) es 1 1 1 y se agrega la fila < 50 °C = 1 1 0. |
| Cap. 8 | Introducción | Agregado | Aviso explícito: ejercicios didácticos, sin certificación SIL/PL; se retira la frase que sugería cumplimiento de IEC 62061/ISO 13849. |
| Cap. 8 | 8.1 | Corregido | Se eliminó el esquema retractado y la fila contradictoria; cadena NC sola en IN1 → NOT → R, rearme NA en IN2 → S (RS). Tabla ejecutada (misma secuencia verificada del 2.3). |
| Cap. 8 | 8.2 | Adaptado | IN3/IN4 y OUT2b no existen; se adapta a 2 entradas (RS + TOF 3 s). Tabla ejecutada. |
| Cap. 8 | 8.3 | Corregido y documentado | OR en el R del RS; alarma enclavada con SR; tabla ejecutada. Lazo con 2 memorias: no convertible a Ladder; 40 renumeraciones aleatorias sin cambios en las filas de la tabla (no prueba de independencia). Casos ch08#6/#7. |
| Cap. 8 | 8.4 | Adaptado | Reset de dos botones imposible con 2 entradas; se reformula como pulsación sostenida de 2 s. Tabla ejecutada. |
| Cap. 8 | 8.5 | Corregido | Cadena NC sola en IN1, INICIO en IN2, contador de ciclos sin reset; se retiró "categoría 1" del título. Tabla ejecutada con PV=3. |
| Cap. 9 | Capítulo | Agregado | Banner: el maestro Modbus existe a nivel de driver pero no hay nodos RDI/RDO/RAI/RAO en editor/compilador/runtime; ejemplos conceptuales, no hardware-verificados; sondeo ≈100 ms. |
| Cap. 9 | 9.1–9.5 | Documentado | Se marcan como conceptuales (no ejecutables ni verificados en hardware); se retiran las afirmaciones "Level 3/igual que local" para nodos inexistentes; límite real de esclavos del firmware (16, descubrimiento 1–10); 9.4: control word es un registro, no una bobina. |
| Cap. 10 | 10.1 | Aclarado | Umbral de 40 °C: 3276 ADC no alcanza por el truncamiento (hace falta ≈3358); la fila "nivel medio" solo aplica al arranque; la alarma de timeout no se enclava. Ladder: convertible. |
| Cap. 10 | 10.2 | Corregido | Se retiró el SR de arranque manual no usado; R_TRIG redundante; se documenta que el contador de lotes no tiene reset. Ladder convertible (BLINK incluido). |
| Cap. 10 | 10.3 | Aclarado | BLINK directo desde SR2 (el AND era redundante); nombres de salida unificados; Ladder convertible. |
| Cap. 10 | 10.4 | Corregido | CMP<0.5 imposible con enteros: SCALE 0–100 (décimas) y CMP<5; el contador de horas solo cuenta tramos continuos de 1 h y no persiste (no es horómetro); el reset por IN2 es incompatible con IN2 = nivel alto. Se ejecutó solo un ejemplo reducido (presión + enclavamiento); el TON de 1 h no se ejecutó. |
| Cap. 10 | 10.5 | Corregido y documentado | IN2 contaba y reseteaba a la vez; reset con R_TRIG en el momento equivocado; alarma de temperatura no cableada. Versión corregida con RS + TON + TP + F_TRIG verificada por ejecución (pulsos de A y B); lazo con 6 memorias, no convertible a Ladder (ch10#6); 40 renumeraciones sin cambios en las filas de la tabla. Variante RDI: conceptual. |
| Cap. 11 | 11.4 | Corregido | Síntomas: "Falta bloque SR" → memoria SR/RS con paro NC; regla R_TRIG/CTU falsa → rebote; toggle "100 Hz" → ~50 Hz; PWM con nota de que no fue probado en ESP32. |
| Cap. 11 | 11.5 | Aclarado | RDI/RDO/RAI/RAO marcados como conceptuales; se agrega aviso del estado real de Modbus. |
| Cap. 11 | 11.6 | Corregido | Casos de diagnóstico y checklist: memoria RS con NOT(paro NC); se elimina "R_TRIG antes de cada CTU"; sin EEPROM para estados de memoria. |
| Apéndice A.2 | A.2 | Corregido | Ciclo de scan: se reemplaza el modelo de fases y "snapshot" por el modelo real (orden de dependencias, corte de lazo en el pivote). |
| Apéndice A.3 | A.3 | Corregido | Se reemplaza la clasificación Level 1/2/3 por la capacidad real del conversor. |
| Glosario | Glosario | Corregido | Se reemplaza "Snapshot IEC 61131-3" por "Orden de evaluación / corte de lazo"; R_TRIG, PWM, RAI/RAO, RDI/RDO y Ciclo de scan corregidos. |
| Cap. 5 | 5.1 | Corregido | Tabla de terminales: se elimina la "Regla fundamental: siempre usar R_TRIG antes del CTU" (falsa) y se reemplaza por el comportamiento verificado y la nota de rebote. |
| Cap. 4 | Resumen | Corregido | Tabla comparativa de temporizadores: fila Ladder actualizada (todos convertibles). |

## Qué NO se verificó
- Ningún ejemplo se probó en hardware ESP32.
- No hubo pruebas Modbus/RS-485 reales; los ejemplos del Cap. 9 son conceptuales.
- El comportamiento del pin PWM frente a escritura digital se conoce solo por lectura de código.
- La equivalencia FBD↔Ladder se comprobó por pruebas diferenciales, no formalmente; las 40 permutaciones de ID (casos 8.3 y 10.5, sin cambios) son evidencia, no prueba.
- Que las memorias no persisten tras reinicio se dedujo del código (sin referencias a EEPROM/NVS para ese estado); no probado en placa.
- Revisión visual hecha sobre una muestra de páginas (portada, índice, 7.2, 8.3, 8.5, apéndices), no sobre las 109.

Estado: E5 listo para tu aprobación. No se inició E6 ni se publicó nada en GitHub.
