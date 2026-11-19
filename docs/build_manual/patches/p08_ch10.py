# -*- coding: utf-8 -*-
from pl import *
OKL='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
after(847,WARN('Sistemas completos = ejercicios de integración',['Estos sistemas integran lo aprendido; son ejercicios didácticos, no diseños de instalación. Donde un ejemplo del v2 no era ejecutable con las 2 entradas y 4 salidas del PLC, la versión v3 lo reduce o lo corrige y lo dice explícitamente.']))
# ---- 10.1 ----
rep(855,'❌ Compatibilidad Ladder: NO CONVERTIBLE (Level 3) — parte analógica.\n  ✅ Parte digital (bomba y alarma): Level 1.','✓ Conversión FBD → Ladder: soportada, incluida la parte analógica (filas numéricas).\n    Validada con pruebas diferenciales; no es una prueba formal de equivalencia.')
rep(862,'(&gt; 3276 ADC)','(ADC ≥ 3358, ≈41 °C reales: con SCALE entero 0–50, 3276 da exactamente 40 y CMP>40 todavía no se activa)')
after(857,V3(['(1) La fila "OK (medio)" con bomba = 0 solo vale al <b>arrancar</b> el sistema con nivel medio; si el nivel venía bajando desde "lleno", el RS retiene el último estado (la bomba sigue como estaba hasta que llegue el nivel alto). (2) Por el truncamiento del SCALE, el ventilador se activa recién con ≥ 41 °C (ADC ≥ 3358), no a 3276. (3) El TON de 10 min cuenta mientras la bomba esté ON; la alarma de timeout <b>no queda enclavada</b>: se apaga cuando la bomba para.'],'Aclaraciones v3 — Ejemplo 10.1'))
log('Cap. 10','10.1','Aclarado','Umbral de 40 °C: 3276 ADC no alcanza por el truncamiento (hace falta ≈3358); la fila "nivel medio" solo aplica al arranque; la alarma de timeout no se enclava. Ladder: convertible.')
# ---- 10.2 ----
replace_block(872,MONO('''  CONTADOR DE PIEZAS:
  [IN1]──[R_TRIG]──CU──[CTU PV=20]──Q_lote
  [IN2]──────────── R──►CTU

  LÓGICA DE CONTROL:
  NOT(Q_lote)──────────────────────────────────────── [OUT1]  (Cinta: ON mientras no hay lote)
  Q_lote────────────────────────────────────────────── [OUT2]  (Sirena)
  Q_lote──EN──[BLINK T=500ms]──Q──────────────────── [OUT3]  (Parpadeo)

  CONTADOR DE LOTES (cuántos lotes se completaron):
  Q_lote──[R_TRIG]──CU──[CTU_LOTES PV=10]──Q──────── [OUT4]  (Fin de turno)
  (Cada vez que Q_lote sube a 1, cuenta un lote. A los 10 lotes: fin de turno.)

  Nota: IN1 = sensor de piezas, IN2 = reset de lote (la cinta arranca automáticamente).
  El R_TRIG en CU es opcional: el CTU cuenta flancos ascendentes por sí mismo.'''))
after(872,V3(['Se quitó el bloque inicial "arranque manual con SR / IN1 largo / IN2 largo", que no se usaba en el programa. El R_TRIG delante del contador de lotes que el v2 llamaba "necesario" es <b>redundante</b> (CTU cuenta flancos). <b>Limitación:</b> el contador de lotes no tiene reset: tras el 10.º lote OUT4 queda enclavado hasta reiniciar el PLC.'],'Corrección v3 — Ejemplo 10.2'))
rep(874,'⚠ Compatibilidad: Level 2 si incluye BLINK.',OKL)
log('Cap. 10','10.2','Corregido','Se retiró el SR de arranque manual no usado; R_TRIG redundante; se documenta que el contador de lotes no tiene reset. Ladder convertible (BLINK incluido).')
# ---- 10.3 ----
rep(884,'SR2 Q──AND──[BLINK 500ms]──► [OUT3]  (Alarma visual)','SR2 Q──────[BLINK 500ms]──► [OUT3]  (Alarma visual)')
rep(884,'❌ Compatibilidad Ladder: NO CONVERTIBLE (Level 3)',OKL)
after(884,V3(['Se eliminó el AND(SR2,SR2) delante del BLINK (redundante: basta SR2 → BLINK). Nombres de salida: OUT1 = ventilador de velocidad <b>baja</b> (zona Alta de temperatura, 25–35 °C), OUT2 = velocidad alta (zona Crítica). El ejercicio 3 hablaba de "zona Alta (OUT1)"; en este manual se usa "OUT1 = vel. baja" en todo el ejemplo.'],'Aclaración v3 — Ejemplo 10.3'))
log('Cap. 10','10.3','Aclarado','BLINK directo desde SR2 (el AND era redundante); nombres de salida unificados; Ladder convertible.')
# ---- 10.4 ----
replace_block(893,MONO('''  CONTROL POR NIVEL (flotantes NC):
  NOT(IN1)──S──[RS]──Q_bomba──────────────────────── [OUT1]  (Bomba)
  NOT(IN2)──R──►

  PROTECCIÓN MARCHA EN SECO (SCALE en DÉCIMAS de bar):
  AI1──[SCALE 0-4095 → 0-100]──[CMP < 5]──A──┐        (5 décimas = 0,5 bar)
                                Q_bomba──B──┤──[AND]──────────── [OUT2]  (Alarma seco)

  TIMEOUT DE FALLA (5 minutos):
  Q_bomba──EN──[TON PT=300000ms]──Q──────────────────── S del SR_timeout
  NOT(IN2)──────────────────────────────────────────── R del SR_timeout
  SR_timeout Q──────────────────────────────────────── [OUT3]  (Alarma timeout)

  SERVICIO (aviso por tiempo de marcha CONTINUA):
  Q_bomba──[TON PT=3600000ms]──Q──[R_TRIG]──CU──[CTU PV=100]──Q── [OUT4]  (Servicio)
  (Cuenta solo tramos de marcha ininterrumpida de 1 hora; ver la aclaración de abajo.)

  ✓ Conversión FBD → Ladder: soportada, incluida la parte analógica. Validada con pruebas
    diferenciales; no es una prueba formal de equivalencia.'''))
after(893,V3(['(1) El v2 comparaba con "CMP<0.5": CMP y SCALE trabajan con <b>enteros</b>, no existe 0,5. Se escala a décimas de bar (SCALE 0–100) y se compara con CMP<5. Verificado en el ejemplo reducido (presión, enclavamiento por nivel y alarma). (2) El ejercicio "presionar IN2 3 s para resetear el contador de horas" choca con que IN2 es el flotante de nivel alto: no es posible con 2 entradas. (3) El "contador de horas" (TON de 1 h → CTU PV=100) <b>solo cuenta tramos de marcha ininterrumpida de 1 hora</b>: el TON se reinicia cada vez que la bomba para, así que ciclos más cortos no acumulan nada. Además, según el código, los contadores viven en RAM y se pierden al reiniciar. <b>No sirve como horómetro de servicio.</b>',
 'Se ejecutaron el TON de 5 min, el enclavamiento del SR_timeout y la protección de presión; el TON de 1 hora completo no se ejecutó.'],'Corrección v3 — Ejemplo 10.4'))
settable(895,[list(r) for r in B[895]['rows']],B[895].get('w'))
rep(895,'Bomba ON y presión &lt; 0.5 bar','Bomba ON y presión &lt; 0,5 bar (CMP&lt;5 con SCALE 0–100)')
rep(895,'100 horas acumuladas de operación','100 tramos de 1 hora de marcha continua (no es un horómetro)')
rep(898,'(presionar IN2 durante 3 segundos para resetear el CTU de horas, confirmando que el mantenimiento fue realizado)','(con las 2 entradas actuales no hay una entrada libre; el ejercicio requiere más entradas, ver Cap. 9 — conceptual)')
tb=rt('10.4',(0,1),['OUT1 (bomba)','OUT2 (alarma seco)'],{'IN1':'IN1 (INICIO)'})
after(895,P('<b>Ejemplo reducido ejecutado</b> (protección por presión baja, SCALE 0–100 = décimas de bar, CMP&lt;5; no es el sistema completo):'),TBL(tb,[220,50,60,60,70,70]))
log('Cap. 10','10.4','Corregido','CMP<0.5 imposible con enteros: SCALE 0–100 (décimas) y CMP<5; el contador de horas solo cuenta tramos continuos de 1 h y no persiste (no es horómetro); el reset por IN2 es incompatible con IN2 = nivel alto. Se ejecutó solo un ejemplo reducido (presión + enclavamiento); el TON de 1 h no se ejecutó.')
# ---- 10.5 ----
replace_block(906,MONO('''  Versión corregida (usa solo IN1, IN2 y las salidas OUT1..OUT4):

  CONTADORES DE INGREDIENTES (IN2 cuenta B y NO resetea):
  [IN1]──[R_TRIG]──CU──[CTU_A PV=10]──Q_A
  [IN2]──[R_TRIG]──CU──[CTU_B PV=5 ]──Q_B

  RECETA ENCLAVADA:
  AND(Q_A, Q_B) ──► S ┌────┐Q
                      │ RS ├──► Q_receta
  Q_F ────────────► R └────┘          (Q_F: fin de descarga, ver abajo)

  CONTROL:
  NOT(Q_receta) ──► [OUT1] (Cinta A)      NOT(Q_receta) ──► [OUT2] (Cinta B)
  Q_receta──[TON PT=30000ms]──Q_mezcla ──[TP PT=5000ms]──Q_desc ──► [OUT4] (Descarga)
  AND(Q_receta, NOT Q_mezcla) ──► [OUT3] (Mezcladora, 30 s)

  FIN DE CICLO (reinicio automático):
  Q_desc ──[F_TRIG]──► Q_F ──► R del RS de receta  y  R de CTU_A y CTU_B

  ✗ Este programa NO se convierte a Ladder: el lazo de realimentación contiene 6 bloques con memoria
    (CTU, CTU, RS, TON, TP, F_TRIG). Ver Apéndice B (caso ch10#6 del banco de pruebas).'''))
after(906,V3(['Defectos del v2: (1) <b>IN2 contaba unidades de B y además iba al R de ambos CTU</b>: cada pulso de B reseteaba los contadores y la receta nunca se completaba; con 2 entradas no se puede separar "contar B" de "resetear". (2) El reset usaba un R_TRIG sobre Q_TOF descripto como "flanco descendente": R_TRIG detecta el ascendente, así que el reset ocurría al <b>abrir</b> la descarga (las cintas arrancaban durante la descarga). (3) La alarma >70 °C estaba descripta pero no cableada.',
 'Versión corregida: receta enclavada con RS, mezcla de 30 s, descarga con un TP de 5 s y reset de los contadores con un F_TRIG de la descarga. La temperatura (AI1) queda como ejercicio: no está incluida en la versión verificada.'],'Corrección v3 — Ejemplo 10.5'),
 WARN('Limitación: realimentación con varias memorias',['El lazo (RS → TON → TP → F_TRIG → RS y CTU) tiene <b>6 bloques con memoria</b>: su comportamiento en el instante exacto del corte del lazo depende del orden interno de los identificadores. En las pruebas, 40 renumeraciones aleatorias no cambiaron ninguna fila de la tabla siguiente (esto no demuestra independencia general). El editor no convierte este programa a Ladder.']),
 TBL(rt('10.5',(0,1,2,3),['OUT1 cinta A','OUT2 cinta B','OUT3 mezcl.','OUT4 desc.']),[260,60,50,50,50,50]))
rep(917,'¿Solo cambian los PV de los CTU?','¿Solo cambian los PV de los CTU? (Sí, en la versión corregida.)')
rep(919,'(IN1 o RDI en módulo remoto)','(requiere una entrada adicional que hoy el PLC no tiene; la variante con RDI es conceptual, ver Cap. 9)')
log('Cap. 10','10.5','Corregido y documentado','IN2 contaba y reseteaba a la vez; reset con R_TRIG en el momento equivocado; alarma de temperatura no cableada. Versión corregida con RS + TON + TP + F_TRIG verificada por ejecución (pulsos de A y B); lazo con 6 memorias, no convertible a Ladder (ch10#6); 40 renumeraciones sin cambios en las filas de la tabla. Variante RDI: conceptual.')
