# -*- coding: utf-8 -*-
from pl import *
RS_FBD='''              S ┌───────────┐
  [IN1] ────────┤           │Q
                │    RS     ├──────────────────── [OUT1]
  [IN2] ──[NOT]─┤ R dominante│
              R └───────────┘

  IN1 (ARRANQUE NA) ───────────── S ──► RS ── Q ──► OUT1 (MOTOR)
  IN2 (PARO NC)  ──► NOT ──────── R ──►

  Pasos en el editor FBD:
  1. Agregar IN1 y IN2 desde la paleta
  2. Agregar NOT (sección Lógica) y RS (sección Mem/Flanco)
  3. Agregar OUT1 desde la paleta
  4. Conectar IN1 → entrada S del RS
  5. Conectar IN2 → entrada del NOT, y salida del NOT → entrada R del RS
  6. Conectar salida Q del RS → entrada de OUT1
  7. GUARDAR → RUN'''
# ======== Ejemplo 2.1 ========
rep(133,'(bloque SR)','(bloque RS con paro NC)')
replace_block(146,MONO(RS_FBD))
after(146,V3(['El Manual v2 conectaba IN2 (paro <b>NC</b>) directamente a R. Pero un NC vale <b>1 en reposo</b>: con R=1 permanente la memoria estaba siempre en reset y el motor se apagaba apenas se soltaba el arranque. Se corrige con un <b>NOT</b> entre IN2 y R.',
 'Además se usa <b>RS</b> (reset dominante) en lugar de SR: con el paro presionado, o con el cable del paro cortado, el reset gana aunque el arranque esté presionado. Con un SR (set dominante) y solo el NOT, el motor <b>podía arrancar con el cable de paro cortado</b>.'],'Corrección v3 — Ejemplo 2.1'))
replace_block(149,MONO('''  Rung 1 — Arranque (memoria M1, bobina SET):
  |    [ IN1 ]                                      (S M1 )      |
  |   Arranque                                      Bobina SET   |

  Rung 2 — Paro (bobina RESET, domina sobre el SET):
  |    [/IN2 ]                                      (R M1 )      |
  |   Paro (NC invertido)                           Bobina RESET |

  Rung 3 — Salida:
  |    [ M1 ]                                       ( OUT1 )     |

  Notas: M1 es una marca interna. El contacto [/IN2] conduce cuando IN2=0,
  es decir cuando el paro NC se presiona o se corta su cable.
  Las bobinas SET/RESET con dominancia de Reset reproducen el bloque RS.

  '''+LADDER_OK if False else '''  Rung 1 — Arranque (memoria M1, bobina SET):
  |    [ IN1 ]                                      (S M1 )      |
  |   Arranque                                      Bobina SET   |

  Rung 2 — Paro (bobina RESET, domina sobre el SET):
  |    [/IN2 ]                                      (R M1 )      |
  |   Paro (NC invertido)                           Bobina RESET |

  Rung 3 — Salida:
  |    [ M1 ]                                       ( OUT1 )     |

  Notas: M1 es una marca interna. El contacto [/IN2] conduce cuando IN2=0,
  es decir cuando el paro NC se presiona o se corta su cable.
  Las bobinas SET/RESET con dominancia de Reset reproducen el bloque RS.

  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
t=res_table('2.1',heads=['<b>Evento</b>','<b>IN1 (arranque NA)</b>','<b>IN2 (paro NC)</b>','<b>OUT1 (motor)</b>'],outs=(0,))
settable(151,t,[200,80,80,80])
log('Cap. 2','2.1','Corregido','FBD: faltaba NOT entre el paro NC y R; se cambia SR por RS (reset dominante) para que el paro y el cable cortado ganen siempre. Ladder y tabla de estados rehechos; la tabla sale de la ejecución firmware==simulador.')
# ======== Ejemplo 2.2 toggle: snapshot ========
replace_block(190,CALL('Sobre la realimentación (retroalimentación)',[
 'La conexión de Q del SR de vuelta a sus propias entradas (vía NOT y AND_RST) se llama <b>realimentación</b>. En este circuito el lazo contiene <b>un solo bloque con memoria</b> (el SR). El motor corta el lazo a la salida de ese bloque: NOT y AND_RST leen el valor de Q del <b>scan anterior</b> (10 ms antes), y el resto se evalúa en el mismo scan en orden de dependencias.',
 '<b>Corrección v3:</b> el Manual v2 afirmaba que "todos los bloques leen el ciclo anterior (snapshot)". No es así: solo se lee el valor anterior en la conexión que se corta en el lazo. Como acá hay un único bloque con memoria, el resultado no depende de los identificadores internos y el toggle funciona igual aunque se renumeren los bloques (verificado con renumeraciones aleatorias; también se convierte a Ladder).'],'v3'))
log('Cap. 2','2.2','Corregido','Recuadro de realimentación: se reemplaza el modelo "snapshot" por el modelo real (corte del lazo en el bloque con memoria).')
# ======== Ejemplo 2.3 emergencia ========
rep(208,'Parada de emergencia NC','Cadena de parada de emergencia NC (ejercicio didáctico)')
replace_block(212,MONO('''  +24V ──[EMERGENCIA NC]──[PARO NC]── IN1       (IN1 = 1 : cadena OK)
  +24V ──[INICIO / REARME NA]──────── IN2
  0V ───────────────────────────────── COM_IN

  Cadena de seguridad en serie (solo contactos NC):
  → Todo OK: los NC conducen → IN1 = 1
  → Emergencia o paro presionados: la cadena abre → IN1 = 0
  → Cable cortado en cualquier punto: IN1 = 0 → fail-safe (mismo efecto)

  IN2 es el pulsador de INICIO / REARME (NA): solo arranca si IN1 = 1.'''))
replace_block(214,MONO('''  FBD:
  [IN2] (INICIO NA) ─────────────────── S ┌───────────┐
                                           │    RS     │Q ─── [OUT1] (Motor/Máquina)
  [IN1] (cadena NC) ──► [NOT] ───────── R └───────────┘

  S = IN2        R = NOT IN1        (reset dominante)

  LADDER:
  Rung 1:  |  [ IN2 ]                                 (S M1 )   |  Inicio
  Rung 2:  |  [/IN1 ]                                 (R M1 )   |  Cadena abierta → RESET (domina)
  Rung 3:  |  [ M1  ]                                 ( OUT1 )  |

  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
after(214,V3(['El Manual v2 ponía la cadena NC <b>en serie con el pulsador de arranque en IN1 y la usaba solo para el SET</b>: abrir la emergencia con la máquina ya en marcha <b>no la detenía</b> (el SET deja de actuar, pero nada hacía RESET), y además el R estaba mal conectado (mismo error del Ejemplo 2.1).',
 'Ahora la cadena NC va a su propia entrada (IN1) y <b>actúa sobre R</b> (R = NOT IN1, con RS de reset dominante); el arranque/rearme es un pulsador NA separado en IN2. Si la cadena abre, la máquina se detiene; al cerrarse de nuevo <b>no rearma sola</b>: hay que volver a pulsar INICIO.'],'Corrección v3 — Ejemplo 2.3'),
 WARN('Ejercicio didáctico',['Esta cadena enseña lógica de enclavamiento con contactos NC. <b>No es una función de parada de emergencia validada</b>: la emergencia real debe cortar la potencia por hardware, independientemente del PLC.']))
tb=res_table('2.3',heads=['<b>Situación</b>','<b>IN1 (cadena NC)</b>','<b>IN2 (INICIO NA)</b>','<b>OUT1 (máquina)</b>'],outs=(0,))
settable(216,tb,[250,80,80,80])
rep(219,'(respuesta: IN1=0 → S=0 → no hay SET)','(respuesta: con la emergencia presionada IN1=0, entonces R=NOT IN1=1 y el reset domina sobre el INICIO: la máquina no arranca)')
rep(220,'¿Cómo saber si la emergencia está activa desde el PLC?','¿Cómo saber si la emergencia está activa desde el PLC? (Pista: NOT IN1.)')
log('Cap. 2','2.3','Corregido','Cadena NC separada del pulsador de inicio y conectada a R (RS con R=NOT IN1): abrir la cadena detiene la máquina en marcha y no rearma sola. Tabla ejecutada. Rotulado como ejercicio didáctico, no función de seguridad.')
# ======== Ejemplo 2.4 interlock ========
after(227,WARN('Limitación de este circuito (realimentación con dos memorias)',[
 'SR1 y SR2 se realimentan entre sí: el lazo contiene <b>dos bloques con memoria</b>. En ese caso el motor corta el lazo en el bloque de menor identificador interno, de modo que si <b>ambos arranques se piden en el mismo scan</b> el ganador depende del orden en que se crearon los bloques: es determinista para un programa dado, pero <b>no está definido por el diseño</b> y cambia si se renumeran los bloques. En las pruebas ganó M2, pero no hay que depender de eso.',
 'Por la misma razón el editor <b>no convierte este programa a Ladder</b> (lo informa en lugar de generar un Ladder que podría comportarse distinto). Lo que sí está garantizado: nunca quedan los dos motores en marcha de forma estable.']))
rep(229,'✅ Compatibilidad: conversión FBD → Ladder PERFECTA (Level 1)','✗ Este programa NO se convierte automáticamente a Ladder (dos memorias en un lazo de realimentación;\n    ver Apéndice B). El Ladder de arriba es solo ilustrativo.')
rep(231,'Solo uno puede quedar en marcha. El SR determina cuál.','Solo uno puede quedar en marcha. Cuál gana NO está definido por el diseño (depende del orden interno de los bloques).')
log('Cap. 2','2.4','Documentado','Se declara que con arranque simultáneo el ganador es indefinido por diseño y que el programa no es convertible a Ladder (2 memorias en el lazo). Corresponde al caso ch01_03#10 del banco de pruebas.')
# ======== Referencia Ladder ========
replace_block(238,MONO('''  Estado de la conversión FBD → Ladder (según el decompilador actual):

  ✓ Se convierten directamente: IN1, IN2, OUT1-4, AND, OR, NOT, SR, RS, TON, TOF, TP,
    CTU, CTD, R_TRIG, F_TRIG, BLINK, CMP, y AI1 / SCALE / PWM (filas numéricas).
  ⚠ Se expande: XOR (se reescribe con AND, OR y NOT).
  ✗ No se convierte: lazos de realimentación sin bloque con memoria o con 2 o más;
    AND con entrada sin conectar; flanco sin entrada; CMP sobre señal booleana;
    PWM sin entrada; señal numérica en entrada booleana. RDI/RDO/RAI/RAO no existen.

  Cuando un programa no se puede convertir, el editor lo informa con el motivo.
  La conversión se valida con pruebas diferenciales, no con una prueba formal.''','Estado de la conversión',  'blue'))
log('Cap. 2','Referencia Ladder','Corregido','Los "Level 1/2/3" estaban desactualizados: BLINK, CMP, AI1, SCALE y PWM sí se convierten; XOR se expande; la lista de lo que no se convierte se reescribió según el decompilador real.')
# ======== Cap. 3 ========
# 3.1
replace_block(254,MONO('''              S ┌───────────┐
  [IN1] ────────┤           │Q ───────────────────────────── [OUT1]  (Verde: en marcha)
                │    SR     │   │
  [IN2] ──[NOT]─┤ S dominante│   └──[NOT]────────────────────── [OUT2]  (Roja: parado)
              R └───────────┘

  S = IN1       R = NOT IN2      (IN2 es el paro NC: vale 1 en reposo)

  La salida Q se usa dos veces:
  → Directamente a OUT1: cuando Q=1 (en marcha), verde enciende
  → Pasando por NOT a OUT2: cuando Q=0 (parado), NOT(Q)=1, roja enciende

  Resultado: las dos lámparas SIEMPRE tienen estados opuestos.'''))
after(254,V3(['Faltaba el NOT entre el paro NC (IN2) y la entrada R: sin él, R=1 en reposo y el sistema no podía mantenerse en marcha. Con el NOT, la tabla de estados de abajo se cumple tal cual (verificada).'],'Corrección v3 — Ejemplo 3.1'))
replace_block(256,MONO('''  Rung 1 — SET (arrancar):
  |    [ IN1 ]                                      (S M1 )      |
  Rung 2 — RESET (parar):
  |    [/IN2 ]                                      (R M1 )      |
  Rung 3 — Lámpara verde:
  |    [ M1 ]                                       ( OUT1 )     |
  Rung 4 — Lámpara roja (estado opuesto):
  |    [/M1 ]                                       ( OUT2 )     |

  Las bobinas SET/RESET usan dominancia de Set (bloque SR).
  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
log('Cap. 3','3.1','Corregido','FBD: NOT entre el paro NC y R. Ladder: rung de SET solo con IN1 (set dominante). La tabla de estados del original coincidía con el comportamiento corregido.')
# 3.2
replace_block(269,{'t':'extitle','x':'<b>Ejemplo 3.2 — Bloque RS: prioridad de Reset para sistemas de seguridad </b>'})
replace_block(275,MONO('''  FBD:
              S ┌───────────┐
  [IN1] ────────┤           │Q
                │    RS     ├───────────────────── [OUT1]  (Prensa)
  [IN2] ──[NOT]─┤ R dominante│
              R └───────────┘          S = IN1     R = NOT IN2

  LADDER (bobinas con dominancia de Reset):
  Rung 1 — Arranque:
  |    [ IN1 ]                                      (S M1 )      |
  Rung 2 — Parada con prioridad:
  |    [/IN2 ]                                      (R M1 )      |
  Rung 3 — Salida:
  |    [ M1 ]                                       ( OUT1 )     |

  Diferencia clave vs SR: con IN1=1 e IN2=0 a la vez, el RS resetea (Q=0) y el SR
  setea (Q=1). El Rung 2 resetea SIEMPRE que IN2=0, sin importar si IN1 está activo.

  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
after(275,V3(['En v2 el FBD conectaba el paro NC (IN2) directo a R. Se agregó el NOT (R = NOT IN2). Los resultados de la comparación SR/RS se verificaron por ejecución: en conflicto (IN1=1, IN2=0) el SR da Q=1 y el RS da Q=0.'],'Corrección v3 — Ejemplo 3.2'))
log('Cap. 3','3.2','Corregido','FBD: NOT entre el paro NC y R. Ladder simplificado a SET (IN1) / RESET (/IN2) con dominancia de Reset. El título del ejemplo se normalizó.')
# 3.3
replace_block(282,{'t':'extitle','x':'<b>Ejemplo 3.3 — Alarma con memoria: Set permanente hasta reconocimiento </b>'})
replace_block(294,MONO('''  Versión sin BLINK (lámpara fija):
  Rung 1:  |  [ IN1 ]                              (S OUT1 )  |
  Rung 2:  |  [ IN2 ]                              (R OUT1 )  |

  Versión con BLINK: el bloque BLINK se convierte a Ladder como bloque oscilador.
  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
log('Cap. 3','3.3','Corregido','Se retiró la afirmación "BLINK Level 2 no se convierte perfectamente": el decompilador convierte BLINK.')
# 3.5
rep(322,'Enclavamiento con prioridad de Reset (seguridad real)','Enclavamiento con prioridad de Reset (ejercicio didáctico de cadena de seguridad)')
replace_block(326,MONO('''  +24V ──[EMERG.1 NC]──[EMERG.2 NC]──[EMERG.3 NC]── IN1     (IN1 = 1 : cadena OK)
  +24V ──[RESET / REARME SUPERVISOR (NA)] ───────── IN2
  0V ─────────────────────────────────────────────── COM_IN

  OUT1 ──[BOBINA CONTACTOR PRENSA]──┐
  COM_OUT ──────────────────────────┘── 0V

  Cadena serie de NC: si CUALQUIER botón se presiona, o se corta un cable, IN1 = 0.'''))
replace_block(328,MONO('''  [IN2] (rearme NA) ─────────────────── S ┌───────────┐
                                           │    RS     │Q ─── [OUT1] (Prensa)
  [IN1] (cadena NC) ──► [NOT] ───────── R └───────────┘

  S = IN2        R = NOT IN1        (reset dominante)

  IN1 = 0 (cadena abierta o cable cortado)  →  R = 1  →  la prensa para (prioridad absoluta).
  IN2 solo puede rearmar si la cadena está cerrada: si IN1 = 0, el reset gana aunque IN2 = 1.'''))
replace_block(330,MONO('''  Rung 1 — Rearme (supervisor):
  |    [ IN2 ]                                      (S M1 )      |
  Rung 2 — Parada con prioridad absoluta:
  |    [/IN1 ]                                      (R M1 )      |
  |   Cadena rota o emergencia                      Bobina RESET |
  Rung 3 — Salida:
  |    [ M1 ]                                       ( OUT1 )     |

  ✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales
    (firmware y simulador); no es una prueba formal de equivalencia.'''))
after(330,V3(['En v2 el botón INICIO (NA) estaba en serie dentro de la cadena de IN1 y el FBD "simplificado" conectaba IN2 (NA) directo a R: pulsar el rearme <b>reseteaba</b> en lugar de rearmar. Ahora la cadena NC está sola en IN1 y actúa sobre R (R = NOT IN1); IN2 (NA) solo hace SET. La secuencia de prueba es la misma del Ejemplo 2.3 (verificada): cadena OK + rearme → marcha; cadena abierta → para; al cerrar la cadena no rearma sola.'],'Corrección v3 — Ejemplo 3.5'),
 WARN('Ejercicio didáctico',['Es un ejercicio sobre prioridad de reset. No reemplaza un circuito de emergencia cableado con relés de seguridad.']))
rep(332,'(Respuesta: para, porque IN1=0 → no hay SET posible y el RS mantiene RESET)','(Respuesta: para, porque IN1=0 → R=NOT IN1=1 y el RS resetea con prioridad)')
log('Cap. 3','3.5','Corregido','Cadena NC sola en IN1 conectada a R (NOT); rearme NA en IN2 conectado a S. Se quitó el FBD "simplificado" incorrecto.')
