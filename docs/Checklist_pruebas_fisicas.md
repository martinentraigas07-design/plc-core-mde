# Checklist de pruebas físicas — PLC-CORE-MDE 6.0.0-rc.1

Estas pruebas **no se hicieron**. Todo lo validado hasta ahora corrió en PC (firmware compilado en el host y simulador). Marcar resultado, fecha y observaciones en cada fila.
Pines: IN1=GPIO21, IN2=GPIO19, AI1=GPIO36, OUT1..4=GPIO14/27/26/25, SW1(WiFi)=GPIO18, LED verde=GPIO2, LED amarillo=GPIO5.
Instrumentos: fuente 24 V, multímetro, osciloscopio (PWM/RS-485), cronómetro, PC/celular con WiFi, dispositivo Modbus RTU de prueba.

## 0. Preparación
| # | Prueba | Resultado esperado | OK |
|---|---|---|---|
| 0.1 | Compilar y grabar firmware; subir `firmware/data/` a SPIFFS | Arranca sin reinicios; LED verde fijo (WiFi) | ☐ |
| 0.2 | Registrar versión del core Arduino-ESP32 y de ArduinoJson usadas | Core 2.x (el código usa `ledcSetup/ledcAttachPin`) y ArduinoJson 6.x | ☐ |
| 0.3 | Tensión de alimentación 23–25 V; COM_IN y COM_OUT al 0 V | Medida correcta | ☐ |

## 1. Entradas digitales (IN1, IN2)
| 1.1 | Pulsador NA en IN1 (monitor) | IN1=1 al presionar, 0 al soltar | ☐ |
| 1.2 | Paro NC en IN2 | IN2=1 en reposo, 0 al presionar | ☐ |
| 1.3 | Rebote: 20 pulsaciones rápidas, contar con CTU | Anotar conteos de más por rebote | ☐ |
| 1.4 | Mantener IN1 con programa IN1→OUT1 | Sin parpadeos; estado estable | ☐ |

## 2. Entrada analógica (ADC)
| 2.1 | Aplicar 0, 2.5, 5, 7.5, 10 V a AI1 | Valores ADC ≈ 0, 1024, 2048, 3072, 4095; anotar desvío y no linealidad | ☐ |
| 2.2 | AI1→SCALE(0–4095→0–100)→CMP | Umbrales conmutan donde se calcula (SCALE trunca hacia cero) | ☐ |
| 2.3 | Ruido/estabilidad con cable apantallado | Anotar fluctuación del ADC en reposo | ☐ |

## 3. Salidas digitales
| 3.1 | Cada OUT1..4 con carga resistiva/LED a +24 V | Conduce con 1 y corta con 0; verificar COM_OUT | ☐ |
| 3.2 | Estado al encender / STOP / RELOAD | Salidas en 0 al arrancar y en STOP | ☐ |
| 3.3 | Corriente máxima de carga prevista | Sin calentamiento anormal | ☐ |

## 4. PWM
| 4.1 | AI1→SCALE→PWM en OUT1: medir frecuencia y duty | ≈5 kHz; duty proporcional (12 bit) | ☐ |
| 4.2 | Barrer entrada 0→100 % | Duty monótono, sin saltos | ☐ |
| 4.3 | OUT con PWM y a la vez salida digital | Comportamiento documentado (el pin queda controlado por PWM): confirmar | ☐ |
| 4.4 | Detener PWM (STOP/RELOAD) | Salida a 0 sin glitches | ☐ |

## 5. Temporizadores
| 5.1 | TON 5 s, TOF 5 s, TP 2 s, BLINK 500 ms (cronómetro/osciloscopio) | Tiempos correctos (±1 scan = 10 ms) | ☐ |
| 5.2 | Re-disparo y reinicio de TON/TOF/TP | Según manual v3 (cap. 4) | ☐ |
| 5.3 | Tiempos largos (≥ 1 min) | Sin deriva apreciable | ☐ |

## 6. Contadores
| 6.1 | CTU PV=5 con IN1; reset con IN2 | CV sube 1 por flanco; Q=1 en CV≥PV | ☐ |
| 6.2 | CTD con LD | CV arranca en 0, Q=1 hasta LD (manual v3) | ☐ |
| 6.3 | Mantener pulsador presionado | CV sube solo 1 | ☐ |

## 7. Biestables SR / RS
| 7.1 | Marcha/paro: RS(S=IN1, R=NOT IN2) con paro NC | Se mantiene al soltar; paro abre → apaga | ☐ |
| 7.2 | Cable de paro desconectado | Motor/salida apagado (comportamiento seguro) | ☐ |
| 7.3 | SR (set domina) y RS (reset domina) con S=R=1 | Según definición | ☐ |

## 8. Persistencia
| 8.1 | Guardar programa, cortar energía, reencender | El programa corre solo y sin intervención | ☐ |
| 8.2 | Cortar energía durante un guardado (repetir ≥ 10 veces) | Siempre queda un programa válido (anterior o nuevo) | ☐ |
| 8.3 | Guardar un programa grande (≥ 30 nodos) | Guarda y carga; anotar heap libre | ☐ |
| 8.4 | Enviar JSON inválido | Se conserva el programa anterior | ☐ |
| 8.5 | Cargar programas guardados con versiones anteriores | Abren y ejecutan | ☐ |

## 9. Servidor web
| 9.1 | Conectarse al AP, abrir `192.168.4.1` | Carga index, program, monitor, manual | ☐ |
| 9.2 | Endpoints: `/status`, `/nodes`, `/load`, `/plc/run`, `/plc/stop`, `/plc/reload`, `/tags/get`, `/io/map` | Respuestas correctas | ☐ |
| 9.3 | Monitor en tiempo real durante 30 min con el programa corriendo | Sin cuelgues ni reinicios; scan estable | ☐ |
| 9.4 | Botón SW1 (GPIO18) apaga/enciende WiFi | El scan no se interrumpe | ☐ |
| 9.5 | Servir `ladder.html`/`js/`/`simulator/` desde SPIFFS (solo si se decide incluirlos; hoy no están en `firmware/data/`) | Decisión pendiente | ☐ |
| 9.6 | Espacio SPIFFS libre tras subir `data/` | Anotar bytes libres | ☐ |

## 10. RS-485 / Modbus (driver)
| 10.1 | Cableado A+/B−/GND y terminación 120 Ω; esclavo Modbus RTU de prueba (9600 8N1) | Señal bien formada en osciloscopio | ☐ |
| 10.2 | `/modbus/discover` (direcciones 1–10) | Detecta el esclavo | ☐ |
| 10.3 | `/modbus/status` y sondeo (~100 ms) | Estado coherente; sin bloquear el scan de 10 ms | ☐ |
| 10.4 | Desconectar esclavo en marcha | El PLC sigue ejecutando; error reportado | ☐ |
| 10.5 | Nota | Los nodos RDI/RDO/RAI/RAO **no existen** en el editor: solo se prueba el driver | ☐ |

## 11. Tiempos y robustez
| 11.1 | Medir el período real del scan con osciloscopio (salida que conmuta cada scan) | ≈10 ms, jitter anotado | ☐ |
| 11.2 | Programa de 64 nodos | Scan dentro del presupuesto | ☐ |
| 11.3 | 24 h en marcha | Sin reinicios ni fugas de heap | ☐ |
