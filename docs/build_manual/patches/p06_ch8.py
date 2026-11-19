# -*- coding: utf-8 -*-
from pl import *
OKL='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
rep(701,'siguiendo los principios de las normas IEC 62061 y ISO 13849','inspirados en los conceptos de las normas IEC 62061 e ISO 13849 (sin pretender cumplirlas)')
after(701,WARN('Ejercicios didácticos, no funciones de seguridad',['Todos los ejemplos de este capítulo son <b>ejercicios didácticos</b> sobre lógica de seguridad. El PLC-CORE-MDE es una plataforma educativa: <b>no está certificado ni validado</b> como función de seguridad (no se evaluó SIL ni PL, ni la categoría de ninguna arquitectura). Las paradas de emergencia reales deben resolverse con hardware de seguridad, independiente de este PLC. Los nombres como "categoría 1" que aparecían en v2 se retiraron para no sugerir conformidad.']))
log('Cap. 8','Introducción','Agregado','Aviso explícito: ejercicios didácticos, sin certificación SIL/PL; se retira la frase que sugería cumplimiento de IEC 62061/ISO 13849.')
# ---- 8.1 ----
replace_block(707,MONO('''  +24V ──[EMER.1 NC]──[EMER.2 NC]──[EMER.3 NC]── IN1     (IN1 = 1 : cadena OK)
  +24V ──[REARME SUPERVISOR NA]────────────────── IN2
  0V ─────────────────────────────────────────────── COM_IN

  OUT1 ──[CONTACTOR PRENSA]──┐
  COM_OUT ───────────────────┘── 0V

  Lógica de la cadena:
  → Todas las emergencias en reposo (NC cerradas): IN1 = 1.
  → Cualquier NC abre (presionado O cable cortado): IN1 = 0 → la prensa PARA y no puede arrancar.
  → Cable cortado en cualquier punto de la cadena: IN1 = 0 → FAIL-SAFE.

  Rearme supervisado (IN2):
  → Después de una emergencia, la cadena debe estar cerrada de nuevo.
  → Solo el supervisor presiona IN2 (NA) para rearmar. Sin IN2 la prensa no vuelve a arrancar sola.'''))
replace_block(709,MONO('''  [IN2] (rearme NA) ─────────────────── S ┌──────┐Q
                                           │  RS  ├──────── [OUT1]  (Prensa)
  [IN1] (cadena NC) ──► [NOT] ───────── R │R dom.│
                                           └──────┘
  S = IN2        R = NOT IN1        (reset dominante)

  Uso de RS (no SR):
  → Si la cadena está abierta (IN1=0) e IN2=1 a la vez → R=1 y RESET gana: la prensa NO arranca.
  → El supervisor puede tener el dedo en el rearme mientras la emergencia sigue activa: la prensa
    sigue parada. La parada tiene PRIORIDAD ABSOLUTA.'''))
after(709,V3(['En v2 esta sección presentaba primero el esquema RS(S=IN1, R=IN2), lo retractaba con un "¡Esperar! Esto parece paradójico" y proponía un AND(IN1,IN2) cuya tabla de estados se contradecía en la fila "IN1=1, IN2=1". Además el botón INICIO NA estaba en serie dentro de la cadena de IN1. Se eliminó la explicación contradictoria. El diseño correcto es el mismo del Ejemplo 2.3: <b>cadena NC sola en IN1 → NOT → R</b>; <b>rearme NA en IN2 → S</b>; la tabla de abajo es la secuencia ejecutada.'],'Corrección v3 — Ejemplo 8.1'))
delete(710)
replace_block(712,MONO('''  Rung 1 — Rearme supervisado:
  |    [ IN2 ]                                      (S OUT1 )   |
  |   Supervisor                                    Bobina SET  |

  Rung 2 — Parada con prioridad (cualquier emergencia):
  |   [/IN1 ]                                       (R OUT1 )   |
  | Cadena rota                                    Bobina RESET |
  | (o emergencia)                                              |

  '''+OKL))
lab={'Cadena OK, sin pulsar INICIO':'Cadena OK, parada','Pulsar INICIO':'Supervisor rearma (cadena OK)','Soltar INICIO (sigue en marcha)':'Suelta el rearme (sigue en marcha)',
 'EMERGENCIA presionada (cadena abre)':'EMERGENCIA presionada (cadena abre)','Cadena cierra de nuevo, sin INICIO (no rearma solo)':'Cadena cierra de nuevo (no rearma sola)',
 'Pulsar INICIO con la cadena OK (rearme)':'Supervisor rearma con la cadena OK','Soltar INICIO':'Suelta el rearme','INICIO pulsado mientras la emergencia sigue activa':'Rearme con la emergencia aún activa (RESET gana)','Cable de la cadena cortado':'Cable de la cadena cortado'}
settable(714,rt('2.3',(0,),['OUT1 (prensa)'],{'IN1':'IN1 (cadena NC)','IN2':'IN2 (rearme NA)'},labels=lab),[260,70,70,70])
log('Cap. 8','8.1','Corregido','Se eliminó el esquema retractado y la fila contradictoria; cadena NC sola en IN1 → NOT → R, rearme NA en IN2 → S (RS). Tabla ejecutada (misma secuencia verificada del 2.3).')
# ---- 8.2 ----
replace_block(723,MONO('''  Adaptación a las 2 entradas reales (el v2 usaba IN3, IN4 y una salida "OUT2b" que no existen):
  IN1 = arranque de la cinta 1 (NA)      IN2 = paro de la cinta 1 (NC)

               S ┌──────┐Q1
  [IN1] ─────────┤      ├───────┬─────────────────────────────────── [OUT1]  (Cinta 1)
                 │  RS  │       │   EN ┌────────────────┐Q
  [IN2] ─[NOT]───┤R dom.│       └──────┤   TOF PT=3000  ├──────────── [OUT2]  (Cinta 2)
               R └──────┘              └────────────────┘

  Lógica:
  → La cinta 2 arranca junto con la cinta 1 (OUT2 sigue a Q1) y NO puede estar en marcha si la cinta 1
    nunca arrancó.
  → Si la cinta 1 para (Q1=0), el TOF mantiene la cinta 2 en marcha 3 s más y luego la para.
  Limitación: con 2 entradas no hay botones propios para la cinta 2 (arranque/paro independientes).'''))
after(723,V3(['El FBD y el Ladder de v2 usaban IN3/IN4 y "OUT2b", que no existen (el PLC tiene 2 entradas y 4 salidas); el compilador rechaza esas referencias. El Ladder v2 también usaba [IN1] donde el texto decía IN3. Se reescribe con 2 entradas; el enclavamiento "la cinta 2 sigue a la cinta 1 con TOF de 3 s" se verificó por ejecución. Los botones independientes de la cinta 2 requerirían más entradas (ver Cap. 9: no ejecutable hoy).'],'Corrección v3 — Ejemplo 8.2'))
replace_block(725,MONO('''  Rung 1:  |  [ IN1 ]                              (S M1   )  |  (cinta 1)
  Rung 2:  |  [/IN2 ]                              (R M1   )  |  (RS: domina)
  Rung 3:  |  [ M1  ]                              ( OUT1  )  |
  Rung 4:  |  [ M1  ]        [TOF PT=3000  Q M2]              |  (retardo de paro C2)
  Rung 5:  |  [ M2  ]                              ( OUT2  )  |  (cinta 2)

  '''+OKL))
after(725,TBL(rt('8.2',(0,1),['OUT1 (cinta 1)','OUT2 (cinta 2)'],{'IN1':'IN1 (arranque NA)','IN2':'IN2 (paro NC)'}),[200,60,60,60,70,70]))
log('Cap. 8','8.2','Adaptado','IN3/IN4 y OUT2b no existen; se adapta a 2 entradas (RS + TOF 3 s). Tabla ejecutada.')
# ---- 8.3 ----
replace_block(734,MONO('''               S ┌──────┐Q                                                         ┌───────────┐
  [IN1] ─────────┤      ├──────┬─────────────────────────────────────── [OUT1]  (Válvula)
  (inicio)       │  RS  │      │  EN ┌─────────────────┐Q          A ┌────┐   │
  [IN2] ──┐      │R dom.│      └─────┤  TON PT=180000  ├──┬──────────┤ OR ├─R─┘
 (nivel   └──────┴──────┘            └─────────────────┘  │       B  │    │
  alto)  ─────────────────────────────────────────────────┼─────────►└────┘
                                                           │
                                      Q_TON ──► [SR alarma: S=Q_TON, R=IN1] ──► [OUT2]  (Alarma)

  R del RS = OR(IN2, Q_TON): un terminal R admite UNA sola conexión, por eso hace falta el OR.
  PT = 180000 ms = 3 minutos.

  Flujo normal:   IN1 → SET → válvula abre → el TON cuenta. IN2 (nivel alto) → RESET → la válvula cierra
                  y el TON se reinicia. Llenado en menos de 3 minutos: no hay alarma.
  Flujo de falla: IN2 no llega → a los 3 min Q_TON=1 → R=1 → la válvula cierra y la alarma queda ENCLAVADA.
  Al cerrar la válvula el TON se reinicia y Q_TON cae: sin el SR de alarma, la alarma duraría 1 scan.'''))
after(734,V3(['Dos defectos de v2: (1) IN2 y Q_TON conectados al mismo terminal R (se pierde uno de los cables: se agrega el OR); (2) al cerrarse la válvula el TON se reinicia y la alarma duraba un solo scan: se agrega un SR de alarma enclavada (S=Q_TON, R=IN1, que se borra al volver a iniciar).'],'Corrección v3 — Ejemplo 8.3'),
 WARN('Limitación: lazo con dos bloques con memoria',['Este circuito tiene un lazo de realimentación (válvula → TON → OR → R del RS) con <b>dos bloques con memoria</b> (RS y TON). El motor corta ese lazo en el bloque de menor identificador interno, por lo que el comportamiento <b>en el instante exacto del corte depende del orden interno de los bloques</b>. En las pruebas, 40 renumeraciones aleatorias de los identificadores no cambiaron ninguna fila de la tabla de abajo, pero eso no prueba independencia general. Por esta razón el editor <b>no convierte este programa a Ladder</b> (casos ch08#6 y ch08#7 del banco de pruebas). Ver Apéndice B.']))
replace_block(738,MONO('''  Este programa NO se convierte automáticamente a Ladder (lazo con RS y TON: dos bloques con memoria;
  ver Apéndice B). El Ladder de v2 se retiró porque no reproducía el FBD (un RS con dos cables en R).

  Si se quiere una versión en Ladder, hay que rediseñar el circuito sin ese lazo, por ejemplo cortando
  la válvula con un contacto en serie en vez de realimentar el TON hacia el R.'''))
after(738,TBL(rt('8.3',(0,1),['OUT1 (válvula)','OUT2 (alarma)'],{'IN1':'IN1 (inicio)','IN2':'IN2 (nivel alto)'}),[220,50,60,60,70,70]))
log('Cap. 8','8.3','Corregido y documentado','OR en el R del RS; alarma enclavada con SR; tabla ejecutada. Lazo con 2 memorias: no convertible a Ladder; 40 renumeraciones aleatorias sin cambios en las filas de la tabla (no prueba de independencia). Casos ch08#6/#7.')
# ---- 8.4 ----
rep(743,'Reset supervisado con dos botones simultáneos','Reset por pulsación sostenida (confirmación de 2 s)')
rep(745,'el operario debe presionar SIMULTÁNEAMENTE dos botones (uno con cada mano). Esto previene resets accidentales con un solo dedo. Además, los botones deben mantenerse presionados 2 segundos para confirmar la intención.','el operario debe mantener presionado el botón de reset durante 2 segundos para confirmar la intención. (En v2 se pedían además dos botones simultáneos; con solo 2 entradas físicas no es posible, porque una entrada es el sensor.)')
replace_block(749,MONO('''  Adaptación a 2 entradas: IN1 = lazo NC del sensor de alarma (1 = normal), IN2 = botón de reset (NA).

               S ┌──────┐Q
  [IN1]──[NOT]───┤  SR  ├──────────────────────────────── [OUT1]  (Alarma)
                 │S dom.│
  [IN2] ──[TON PT=2000]──┤      │
               R └──────┘

  S = NOT IN1        R = Q_TON  (TON de 2 s alimentado por IN2)

  → TON 2 s: solo si IN2 se mantiene presionado 2 segundos continuos.
  → Mientras el sensor siga en alarma (S=1), el SR (set dominante) NO se puede resetear: primero debe
    volver el lazo a normal y recién entonces el reset sostenido apaga la alarma.
  Limitación: la versión de dos botones simultáneos necesita más entradas (por ejemplo RDI de Modbus,
  que el editor todavía no tiene: ver Capítulo 9).'''))
after(749,V3(['En v2 IN1 era a la vez el sensor y uno de los botones; con SR el reset no actuaba nunca mientras IN1=1, y con RS la alarma volvía a armarse al soltar el botón. El ejemplo, tal como estaba, no era ejecutable con 2 entradas. Se reformula con un solo botón sostenido 2 s (confirmación) y se verifica por ejecución.'],'Corrección v3 — Ejemplo 8.4'))
replace_block(751,MONO('''  Rung 1 — Activación alarma:
  |    [/IN1 ]                                    (S OUT1 )   |
  Rung 2 — Confirmación de 2 s:
  |    [ IN2 ]                  [TON PT=2000  Q M1]           |
  Rung 3 — Ejecutar reset:
  |    [ M1  ]                                    (R OUT1 )   |

  '''+OKL))
settable(753,rt('8.4',(0,),['OUT1 (alarma)'],{'IN1':'IN1 (lazo NC)','IN2':'IN2 (reset)'}),[300,60,60,70,70])
log('Cap. 8','8.4','Adaptado','Reset de dos botones imposible con 2 entradas; se reformula como pulsación sostenida de 2 s. Tabla ejecutada.')
# ---- 8.5 ----
replace_block(758,{'t':'extitle','x':'<b>Ejemplo 8.5 — Prensa con cadena de seguridad (ejercicio didáctico) </b>'})
rep(760,'tiempo mínimo de paro antes de rearme, lámpara de estado','retardo de arranque, lámpara de estado')
rep(762,'Cadena: EMER1 NC + EMER2 NC + EMER3 NC + INICIO NA','Cadena: EMER1 NC + EMER2 NC + EMER3 NC (en serie)')
rep(762,'Arranque supervisado + cadena de seguridad','Cadena de seguridad (1 = OK)')
rep(763,'Reset supervisor NA','INICIO / rearme supervisado (NA)')
rep(763,'Habilita rearme después de emergencia','Rearma solo si la cadena está cerrada')
replace_block(765,MONO('''  LÓGICA DE ARRANQUE Y SEGURIDAD:
  [IN2] (INICIO NA) ───────────────── S ┌──────┐Q        EN ┌──────────────┐Q
                                         │  RS  ├───┬────────┤  TON PT=3000 ├──┬───────── [OUT1] (Contactor)
  [IN1] (cadena) ──► [NOT] ───────── R │R dom.│   │        └──────────────┘  ├───────── [OUT3] (Verde: en marcha)
                                         └──────┘   │                          │
                                                    └──[AND]◄──[NOT]◄───────────┘
                                                         └───────────────────────────── [OUT2] (Amarilla: espera)

  CONTADOR DE CICLOS:
  [IN2] ──[CTU PV=500]──Q──────────────────────────────── [OUT4]  (Alarma de mantenimiento)
  (cuenta cada INICIO; IN2 es a la vez INICIO y entrada de conteo; el contador NO tiene reset)

  LÓGICA:
  → SET: IN2=1 (INICIO). RESET: IN1=0 (emergencia o cable cortado), con prioridad.
  → TON 3 s: retardo de arranque.  OUT1 = OUT3 = Q_TON.   OUT2 = Q_RS AND NOT(Q_TON).
  → OUT4: alarma cuando el CTU llega a PV (500 en el ejemplo; se probó con PV=3).'''))
after(765,V3(['En v2 el botón INICIO estaba en serie dentro de la cadena de IN1 (heredando el defecto del 8.1) y IN2 era a la vez habilitación de arranque y entrada R del CTU: mientras se arrancaba (IN2=1) el contador estaba en reset. Se rediseña con la cadena NC sola en IN1, INICIO en IN2 y un contador de ciclos <b>sin reset</b> (queda enclavado hasta reiniciar el PLC: limitación a tener en cuenta). Se probó con PV=3 para no simular 500 ciclos.'],'Corrección v3 — Ejemplo 8.5'),
 WARN('Ejercicio didáctico',['El título "categoría 1" del v2 se retiró: este circuito no está evaluado según ISO 13849. Es un ejercicio de lógica de seguridad.']))
replace_block(767,MONO('''  Rung 1:  |  [ IN2 ]                              (S M1   )  |  (INICIO)
  Rung 2:  |  [/IN1 ]                              (R M1   )  |  (emergencia, domina)
  Rung 3:  |  [ M1  ]        [TON PT=3000  Q M2]              |  (retardo arranque)
  Rung 4:  |  [ M2  ]                              ( OUT1  )  |  (contactor)
  Rung 5:  |  [ M2  ]                              ( OUT3  )  |  (verde)
  Rung 6:  |  [ M1  ] [/M2 ]                       ( OUT2  )  |  (amarilla: espera)
  Rung 7:  |  [ IN2 ]        [CTU PV=500   Q M3]              |  (contador de ciclos)
  Rung 8:  |  [ M3  ]                              ( OUT4  )  |  (alarma mant.)

  '''+OKL))
after(767,TBL(rt('8.5',(0,1,2,3),['OUT1 K1','OUT2 amar.','OUT3 verde','OUT4 mant.'],{'IN1':'IN1 (cadena NC)','IN2':'IN2 (INICIO)'}),[190,50,50,60,45,45,45,45]),
 TBL([['<b>Nota</b>','<b>Detalle</b>'],['Tabla ejecutada','Con PV=3 en lugar de 500, para llegar al conteo en pocos ciclos.']],[80,300]))
log('Cap. 8','8.5','Corregido','Cadena NC sola en IN1, INICIO en IN2, contador de ciclos sin reset; se retiró "categoría 1" del título. Tabla ejecutada con PV=3.')
# ---- resumen ----
rep(773,'AND(IN1_cadena, IN2_supervisor) → S del RS','IN2 (rearme NA) → S del RS; NOT(IN1 cadena NC) → R del RS')
rep(773,'AND(IN1, IN2) → TON → R del SR','Botón NA → TON → R del SR (dos botones simultáneos necesitan más entradas)')
rep(773,'TON → R del RS + alarma','TON → OR(…) → R del RS + SR de alarma enclavada')
