# -*- coding: utf-8 -*-
from pl import *
OKL='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
# ===== 4.4 BLINK =====
replace_block(413,MONO('''  Ladder: el bloque BLINK se representa como un bloque oscilador con EN y período T.
  También se puede aproximar con una marca interna parpadeante, pero no hace falta:
  el editor convierte el BLINK directamente.

  Ejemplo:  |  [ M1 ]            [BLINK T=1000  Q M2]            |
            |  [ M2 ]                              ( OUT1 )       |

  '''+OKL))
log('Cap. 4','4.4','Corregido','BLINK ya no figura como "Level 2 / aproximado": el decompilador lo convierte como bloque oscilador.')
# ===== 4.6 alarma por tiempo =====
replace_block(437,MONO('''              S ┌─────────┐Q
  [IN1] ────────┤         ├──────────────────────────────── [OUT1]  (BOMBA)
  (nivel bajo)  │   RS    │
  [IN2] ────────┤ R domin.│     Q  EN ┌──────────────────┐Q
  (nivel alto   R└─────────┘ ─────────┤  TON PT=300000ms ├──────── [OUT2]  (ALARMA)
   / reset NA)                         └──────────────────┘

  PT = 300000 ms = 5 minutos
  Si el nivel sigue bajo y la bomba lleva 5 minutos encendida:
  → TON acumula 300000 ms → Q_TON=1 → OUT2=1 → alarma suena.
  Si llega la señal de nivel alto (IN2) antes de los 5 minutos:
  → RS Q=0 → la bomba para → TON se reinicia → la alarma no suena.
  Si IN2 se activa después de la alarma: RS Q=0 → bomba para → TON reinicia → alarma apaga.'''))
after(437,V3(['El Manual v2 usaba SR (set dominante) con S=IN1 (nivel bajo, señal <b>sostenida</b>) y R=IN2: mientras el nivel siguiera bajo, el operario no podía detener la bomba con IN2 porque el SET ganaba. Se cambia a <b>RS (reset dominante)</b>, como pide el propio Capítulo 8.',
 'Limitación que conviene entender: IN1 es un nivel, no un pulso. Si IN2 resetea mientras IN1 sigue en 1, en el scan siguiente el SET vuelve a actuar y la bomba rearma. La alarma se apaga cuando la bomba se detiene (el TON se reinicia).'],'Corrección v3 — Ejemplo 4.6'))
replace_block(439,MONO('''  Rung 1:  |  [ IN1 ]                              (S M1   )  |  (arranque bomba)
  Rung 2:  |  [ IN2 ]                              (R M1   )  |  (paro bomba, domina)
  Rung 3:  |  [ M1  ]                              ( OUT1  )  |  (bomba ON)
  Rung 4:  |  [ M1  ]      [TON PT=300000    Q M2]            |  (timeout 5 min)
  Rung 5:  |  [ M2  ]                              ( OUT2  )  |  (alarma)

  '''+OKL))
settable(441,res_table('4.6',outs=(0,1)),[220,40,40,80,50,50])
log('Cap. 4','4.6','Corregido','SR→RS (reset dominante) para que el operario o el nivel alto puedan detener la bomba aunque IN1 siga activo; Ladder y tabla de estados ejecutada.')
rep(444,'(Pista: usar Q_TON como entrada R de un RS)','(Pista: la entrada R del RS admite una sola conexión, así que hace falta un OR entre IN2 y Q_TON.)')
# ===== Cap. 5: la regla del R_TRIG =====
replace_block(453,MONO('''  Un sensor activo 50 ms equivale a 5 scans con IN1=1, pero el CTU cuenta FLANCOS:

  Sin R_TRIG:  [SENSOR]──CU──[CTU]                 → cuenta 1 por cada flanco 0→1
  Con R_TRIG:  [SENSOR]──[R_TRIG]──CU──[CTU]       → cuenta 1 por cada flanco 0→1

  Ambos circuitos cuentan 1 en este caso. El R_TRIG es inofensivo pero REDUNDANTE
  antes de un CTU (o CTD): el contador ya detecta el flanco ascendente de CU/CD.'''))
after(453,V3(['El Manual v2 enseñaba que sin R_TRIG el CTU "cuenta 5" y que había que poner <b>siempre</b> un R_TRIG antes del CTU. En este firmware y en el simulador eso es falso: <b>CTU y CTD cuentan solo en el flanco ascendente de CU/CD</b> (verificado: 5 pulsos de 3 scans cada uno → CV=5, con el CTU conectado directo al sensor).',
 'Se conservan los R_TRIG de los ejemplos como práctica de legibilidad, pero ya no se afirma que sean necesarios. Sí siguen siendo necesarios para un toggle (Cap. 2), que no tiene detección de flanco propia.'],'Corrección v3 — regla "R_TRIG antes del CTU"'),
 TBL([['<b>Pulso de IN1 (3 scans en 1)</b>','<b>OUT1 (Q del CTU, PV=5)</b>'],['1','0'],['2','0'],['3','0'],['4','0'],['5','1']],[200,150]))
log('Cap. 5','Regla R_TRIG','Corregido','Se eliminó la regla falsa "siempre R_TRIG antes del CTU" (CTU/CTD cuentan solo en flanco ascendente); verificado por ejecución con CTU conectado directo al sensor.')
rep(472,'Probar sin R_TRIG: mantener IN1 presionado y observar que CV sube rápidamente. Luego restaurar R_TRIG.','Probar sin R_TRIG: mantener IN1 presionado varios segundos y observar que CV sube solo 1 (el CTU cuenta el flanco, no el nivel). Comparar con el toggle del Cap. 2, que sí necesita R_TRIG.')
# 5.2 salida del motor
after(483,INFO('Salida del motor',['En este circuito OUT1 es el aviso de mitad de lote y OUT2 la alarma de lote completo. El motor necesita <b>una salida propia</b> (por ejemplo OUT3 = NOT Q_CTU_B); el FBD original reutilizaba "OUT1" también para la habilitación del motor, lo cual no es posible con un solo OUT1.']))
log('Cap. 5','5.2','Aclarado','El motor debe ir a otra salida (OUT3); el FBD original usaba OUT1 para dos funciones.')
# 5.3 CTD real
after(494,WARN('CTD real: estado al encender',['Al encender el PLC el CTD arranca con <b>CV=0 y Q=1</b> (porque Q=1 cuando CV ≤ 0) hasta que se aplica una carga LD: la alarma de "sin stock" estaría activa en el arranque. Hay que dar un pulso de LD (IN2) para cargar CV=PV antes de usarla, o ignorar Q durante el arranque. El manual v2 no lo mencionaba.']))
log('Cap. 5','5.3','Aclarado','CTD: CV=0 y Q=1 al encender hasta que se aplique LD.')
# 5.5 cascada
replace_block(522,MONO('''  ┌──────┐  ┌────────┐  CU ┌───────────────┐Q   CU ┌───────────────┐Q
  │ IN1  ├──┤ R_TRIG ├─────┤  CTU_1 PV=10  ├───────┤  CTU_2 PV=10  ├── [OUT1](100 piezas)
  └──────┘  └────────┘     │               │       │               │
                           │               │Q  R──►│               │
                           └───────────────┘       └───────────────┘
                                    │Q
                                    └──► [OR] ──► R del CTU_1       IN2 ──► R del CTU_2 y 2ª entrada del OR
                                    (auto-reset: cuando CTU_1 llega a 10, Q=1 → R=1 → CV vuelve a 0 → Q=0)

  El auto-reset (Q → R del mismo bloque) funciona así:
  Scan N:   CU activo → CV sube a 10 → Q=1.
  Scan N+1: el R lee el Q del scan anterior (el lazo se corta a la salida de CTU_1) → CV vuelve a 0 → Q=0.
  El pulso de Q dura 1 scan (10 ms) y llega a CU del CTU_2 → CTU_2 cuenta 1.

  IN2 resetea AMBOS contadores: el R de CTU_1 admite UNA sola conexión, por eso lleva un OR
  entre su propia Q (auto-reset) e IN2.'''))
after(522,V3(['En v2 se explicaba el auto-reset con el modelo de "snapshot", que no es el del motor, y se dibujaban dos cables al mismo R del CTU_1 (Q e IN2): un terminal R admite <b>una sola conexión</b>, y el firmware, el simulador y el compilador descartan la segunda. Se agrega el OR. Este programa tiene un lazo con <b>un solo</b> bloque con memoria (el CTU_1), por eso su comportamiento no depende de los identificadores internos y se convierte a Ladder (caso ch05#6 del banco de pruebas).'],'Corrección v3 — Ejemplo 5.5'))
rep(527,'¿Por qué el auto-reset del CTU_1 funciona correctamente con el modelo de snapshot? Si el PLC no tuviera snapshot, ¿qué problema habría?','¿Por qué el pulso de Q del CTU_1 dura exactamente un scan? (Pista: en el lazo Q→R, el R lee el valor de Q del scan anterior.)')
log('Cap. 5','5.5','Corregido','Se agregó el OR en el R del CTU_1 (un terminal R admite una sola conexión) y se reemplazó la explicación "snapshot" por la del corte del lazo. Convertible a Ladder (caso ch05#6).')
