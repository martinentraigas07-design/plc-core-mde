# -*- coding: utf-8 -*-
from pl import *
OKL='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
after(628,WARN('Ejercicios didácticos',['Los circuitos de este capítulo son <b>ejercicios didácticos</b> inspirados en aplicaciones industriales. No son proyectos listos para instalar: la potencia, las protecciones y la seguridad de una instalación real deben ser diseñadas y verificadas por personal competente. El PLC-CORE-MDE es una plataforma educativa y no está validado como función de seguridad.']))
# ---- 7.1 ----
rep(635,'el SR activa su memoria (Q=1)','el RS activa su memoria (Q=1)')
replace_block(637,MONO('''               S ┌──────┐        EN ┌──────────────┐Q
  [IN1] ─────────┤      │Q ────────┤   TON        ├──────────── [OUT1]  (Contactor K1)
                 │  RS  │          │  PT=3000ms   │
  [IN2] ─[NOT]───┤R dom.│          └──────────────┘Q
               R └──────┘                 │
                                          ├─────────────────────── [OUT2](Verde: en marcha)
                                          │
                                          └──[NOT]─────────────── [OUT3](Roja: parado)

  S = IN1       R = NOT IN2   (IN2 es el paro NC: vale 1 en reposo)

  Nota: la lámpara verde (OUT2) enciende DESPUÉS del retardo de 3s, igual que el contactor.
  La lámpara roja (OUT3) enciende cuando el motor está parado O durante el retardo.'''))
after(637,V3(['El Manual v2 conectaba el paro NC (IN2) directo a R de un SR, por lo que el motor nunca arrancaba (R=1 en reposo). Ahora: <b>RS con R = NOT IN2</b>. La tabla de estados de abajo sale de la ejecución del programa.'],'Corrección v3 — Ejemplo 7.1'))
replace_block(639,MONO('''  Rung 1:  |  [ IN1 ]                              (S M1   )  |  (RS: arranque)
  Rung 2:  |  [/IN2 ]                              (R M1   )  |  (RS: paro, domina)
  Rung 3:  |  [ M1  ]             [TON PT=3000 Q M2]           |  (retardo 3s)
  Rung 4:  |  [ M2  ]                              ( OUT1  )  |  (contactor)
  Rung 5:  |  [ M2  ]                              ( OUT2  )  |  (verde)
  Rung 6:  |  [/M2  ]                              ( OUT3  )  |  (roja)

  '''+OKL))
settable(641,rt('7.1',(0,1,2),['OUT1 (K1)','OUT2 (verde)','OUT3 (roja)'],{'IN1':'IN1 (arranque NA)','IN2':'IN2 (paro NC)'}),[200,50,50,50,55,55,55])
log('Cap. 7','7.1','Corregido','RS con R=NOT IN2 (el paro NC estaba conectado directo a R); Ladder y tabla de estados ejecutada.')
rep(646,'(Respuesta: no. Solo cambia el cableado.)','(Respuesta: no. Solo cambia el cableado, porque el contacto NC del térmico queda en serie con el paro NC y IN2 sigue valiendo 1 en reposo.)')
# ---- 7.2 ----
replace_block(656,MONO('''               S ┌──────┐Q
  [IN1] ─────────┤      ├──────────────────────────────────────── [OUT1]  (K1 principal)
                 │  RS  │
  [IN2] ─[NOT]───┤R dom.│         EN ┌──────────────┐Q
               R └──────┘Q ─────────┤  TON PT=8000 ├──────┬──────────────────────────────┐
                              │      └──────────────┘      │                              │
                              │                    [NOT] ──┤        EN ┌──────────────┐Q │
                              │                            │      ────┤  TON PT=100  ├───┴── [OUT3] (K3 triángulo)
                              └──────────[AND]◄── NOT(Q_TON8)         └──────────────┘
                                          └──────────────────────────────────────────── [OUT2] (K2 estrella)

  K1 = Q_RS            K2 = Q_RS AND NOT(Q_TON8)            K3 = TON(100 ms) alimentado por Q_TON8

  Secuencia automática:
  t=0:     RS=1 → K1 ON y K2 ON (estrella). El TON de 8 s empieza a contar.
  t=8 s:   Q_TON8=1 → K2 se abre de inmediato. K3 cierra 100 ms DESPUÉS (tiempo muerto).
  Paro:    RS=0 → K1, K2 y K3 OFF (el TON de 100 ms se reinicia).'''))
after(656,V3(['Dos correcciones sobre el v2: (1) el paro NC (IN2) se invierte con NOT antes de R (RS), como en el Ejemplo 2.1; (2) en v2 OUT2 = NOT(Q_TON) dejaba K2 energizado con el motor parado y, a los 8 s, K2 caía y K3 subía <b>en el mismo scan</b>. Ahora K2 = Q_RS AND NOT(Q_TON) y K3 espera un <b>tiempo muerto de 100 ms</b> (TON) para que K2 abra antes de que K3 cierre.'],'Corrección v3 — Ejemplo 7.2'),
 WARN('El tiempo muerto del PLC no reemplaza al enclavamiento eléctrico',['100 ms es un valor didáctico del programa: el tiempo de apertura real de un contactor depende del contactor. El enclavamiento eléctrico (NC cruzados) sigue siendo obligatorio.']))
replace_block(658,MONO('''  Rung 1:  |  [ IN1 ]                        (S M1   )  |
  Rung 2:  |  [/IN2 ]                        (R M1   )  |  (RS: domina)
  Rung 3:  |  [ M1  ]                        ( OUT1  )  |  (K1 principal)
  Rung 4:  |  [ M1  ]        [TON PT=8000  Q M2]        |
  Rung 5:  |  [ M1  ] [/M2 ]                 ( OUT2  )  |  (K2 estrella)
  Rung 6:  |  [ M2  ]        [TON PT=100   Q M3]        |  (tiempo muerto)
  Rung 7:  |  [ M3  ]                        ( OUT3  )  |  (K3 triángulo)

  '''+OKL))
settable(660,rt('7.2',(0,1,2),['OUT1 (K1)','OUT2 (K2 Y)','OUT3 (K3 Δ)'],{'IN1':'IN1 (arranque NA)','IN2':'IN2 (paro NC)'}),[190,50,50,60,55,55,55])
log('Cap. 7','7.2','Corregido','RS con NOT en el paro NC; K2 = Q_RS·NOT Q_TON (antes quedaba energizado con el motor parado); tiempo muerto de 100 ms entre K2 y K3; Ladder y tabla ejecutada.')
# ---- 7.3 ----
replace_block(671,MONO('''            EN ┌──────────────────┐Q
  [IN1] ───────┤   TP  PT=20000ms ├────┬───────────────────────── [OUT1]  (Rojo vehicular)
               └──────────────────┘    │
                                       ├──[NOT]──────────────── [OUT2]  (Verde vehicular)
                                       │
                                       │  EN ┌──────────────────┐Q   A ┌─────┐
                                       ├─────┤  TON PT=3000ms   ├──────┤ AND ├──┬──── [OUT3]  (Verde peatón)
                                       │     └──────────────────┘      │     │  └──── [OUT4]  (Señal acústica)
                                       └──────────────────────────────B┤     │
                                                                        └─────┘

  IN1 dispara el TP (20 s). El TP no se re-dispara si se presiona de nuevo durante el pulso.
  OUT1 = Q_TP.   OUT2 = NOT(Q_TP).
  El TON de 3 s se alimenta con Q_TP (NO directamente con IN1): cuenta desde que empieza el rojo.
  OUT3 = OUT4 = Q_TON AND Q_TP: verde peatón desde los 3 s hasta que termina el rojo (a los 20 s).
  '''+OKL))
after(671,V3(['En v2 el TON de 3 s se alimentaba directo de IN1, por lo que el verde peatonal solo salía si el pulsador se mantenía presionado 3 s; con un pulsador momentáneo (lo normal) los autos quedaban en rojo 20 s sin verde para el peatón. Ahora el TON cuenta desde Q_TP y el verde peatonal se limita con AND a la duración del rojo. Resultado verificado en la tabla.'],'Corrección v3 — Ejemplo 7.3'))
settable(673,rt('7.3',(0,1,2,3),['OUT1 rojo veh.','OUT2 verde veh.','OUT3 verde peat.','OUT4 acústica'],{'IN1':'IN1 (botón)'}),[170,50,60,50,50,50,50])
log('Cap. 7','7.3','Corregido','TON de 3 s alimentado por Q del TP (no por IN1) y AND con Q_TP para que el verde peatón dure hasta el fin del rojo; tabla ejecutada.')
# ---- 7.4 ----
rep(680,'(reset con IN1 e IN2 simultáneos)','(reconocimiento con un pulsador)')
replace_block(682,MONO('''  Adaptación a las 2 entradas reales del PLC:
  IN1 = lazo NC de TODOS los sensores de zona, en serie (1 = todo normal; 0 = alguna zona abierta o cable cortado)
  IN2 = pulsador de reconocimiento (NA)

               S ┌──────┐Q
  [IN1]──[NOT]───┤  SR  ├────────┬───────────────── [OUT2]  (Indicador de alarma)
                 │S dom.│        │
  [IN2] ─────────┤      │        └──► [BLINK T=500ms] ──► [OUT1]  (Sirena)
               R └──────┘

  S = NOT IN1     R = IN2   (SR: si la zona sigue abierta, el SET domina y el reconocimiento no apaga)

  Las zonas NO se pueden distinguir con 2 entradas. Para indicar la zona hacen falta más entradas
  (ver Capítulo 9: la expansión Modbus existe a nivel de driver, pero el editor todavía NO tiene
  los bloques RDI/RDO/RAI/RAO, así que ese ejemplo no se puede programar hoy).'''))
after(682,V3(['El Manual v2 usaba el mismo par de entradas (IN1, IN2) como sensores <b>y</b> como reset (AND(IN1,IN2)): con SR el reset nunca actuaba, y con RS aparecía cuando las dos zonas disparaban juntas (la alarma se perdía). Además la versión "con módulo RS-485" usaba bloques RDI que el editor no tiene. Se adapta el ejemplo a lo que el PLC puede hacer hoy: un lazo NC en serie (fail-safe por corte de cable) y un pulsador de reconocimiento.'],'Corrección v3 — Ejemplo 7.4'))
replace_block(684,MONO('''  Rung 1:  |  [/IN1 ]                              (S M1   )  |  (alarma: lazo abierto)
  Rung 2:  |  [ IN2 ]                              (R M1   )  |  (reconocimiento)
  Rung 3:  |  [ M1  ]                              ( OUT2  )  |  (indicador)
  Rung 4:  |  [ M1  ]        [BLINK T=500  Q M2]              |  (oscilador)
  Rung 5:  |  [ M2  ]                              ( OUT1  )  |  (sirena parpadeante)

  '''+OKL))
after(684,TBL(rt('7.4',(0,1),['OUT1 sirena','OUT2 indicador'],{'IN1':'IN1 (lazo NC)','IN2':'IN2 (reconoc.)'}),[200,50,50,60,70,70]))
log('Cap. 7','7.4','Adaptado','Sensores y reset compartían IN1/IN2 (el reset no actuaba) y la variante RS-485 usaba RDI inexistentes. Se reformula con lazo NC en IN1 y reconocimiento en IN2 (SR + BLINK). Se pierde la distinción de zonas (2 entradas). Tabla ejecutada.')
rep(688,'(requiere revisión)','(ejercicio abierto; hay que diseñar cómo detectar cada nuevo evento)')
# ---- 7.5 ----
rows=[list(r) for r in B[695]['rows']]
i=[k for k,r in enumerate(rows) if r[0].startswith('55-50')][0]
rows[i]=['55-50°C (bajando)','1','1','1','La alta recién apaga por debajo de 50°C (histéresis): sigue encendida']
rows.insert(i+1,['&lt; 50°C (bajando)','1','1','0','Vel. alta apaga; baja y media siguen'])
settable(695,rows,B[695].get('w'))
after(695,V3(['La fila "55–50 °C (bajando)" decía 1 1 0, pero con histéresis de 5 °C la velocidad alta se apaga recién por debajo de 50 °C: entre 55 y 50 sigue encendida (1 1 1). Verificado por ejecución.'],'Corrección v3 — Ejemplo 7.5'))
log('Cap. 7','7.5','Corregido','Tabla: la fila 55–50 °C (bajando) es 1 1 1 y se agrega la fila < 50 °C = 1 1 0.')
