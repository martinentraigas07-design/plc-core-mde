# -*- coding: utf-8 -*-
import re
from pl import *
OKL='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
replace_block(543,CALL('SCALE y Ladder (corregido en v3)',[
 'El bloque SCALE realiza una conversión lineal sobre valores <b>enteros</b>. En el Manual v2 se decía que era "incompatible con Ladder (Level 3)" y que esos programas eran "solo FBD". <b>Ya no es así</b>: el editor convierte AI1, SCALE, CMP y PWM a filas numéricas del Ladder (validado por pruebas diferenciales, no formales). Siguen sin convertirse los casos listados en el Apéndice B.',
 '<b>Importante:</b> la división del SCALE es entera y <b>trunca hacia cero</b> (y el resultado se limita a [outMin, outMax]). Por eso 18,0 °C ideales (ADC 1474) se leen como 17 °C. Si necesitás decimales, escalá a un rango mayor (por ejemplo 0–500 para décimas de °C) y compará contra valores enteros en esa unidad.'],'v3'))
log('Cap. 6','Recuadro SCALE','Corregido','Se retiró "SCALE incompatible con Ladder (Level 3)"; se agregó el aviso de truncamiento hacia cero y la forma de ganar resolución.')
# truncamiento en la fórmula
after(542,V3(['El SCALE usa aritmética entera con división truncada hacia cero. Ejemplos con el sensor 0–50 °C (outMax=50): ADC 1474 → 17, ADC 1475 → 18, ADC 2129 → 25, ADC 2130 → 26. La resolución con outMax=50 es de 1 °C.'],'Aclaración v3 — truncamiento'))
# 6.1 cableado de la salida: COM_OUT va al 0V (igual que el resto del manual)
rep(548,'  COM_OUT ──────────────────────────── +24V  (LOW-SIDE: COM_OUT al +24V para PWM)','  +24V ───────────────────────────── (la carga va entre +24V y OUT1)\n  COM_OUT ──────────────────────────── 0V   (LOW-SIDE: COM_OUT siempre al 0V)')
rep(548,'OUT1 ──[LED con R limitadora 1kΩ]──┐','OUT1 ──[LED con R limitadora]──┐')
rep(548,'La frecuencia PWM es interna al firmware (~1kHz).','La frecuencia PWM es interna al firmware (5 kHz, resolución 12 bits).')
log('Cap. 6','6.1','Corregido','Cableado de la carga PWM: COM_OUT va siempre al 0V (el original lo conectaba al +24V, contra la regla del propio manual). Frecuencia PWM: 5 kHz (el original decía ~1 kHz), según plc_io.cpp.')
rep(550,'❌ Compatibilidad Ladder: NO CONVERTIBLE (Level 3)\n  AI1, SCALE y PWM no tienen equivalente en Ladder estándar.','✓ Conversión FBD → Ladder: soportada (filas numéricas). Validada con pruebas diferenciales;\n    no es una prueba formal de equivalencia.')
after(550,INFO('PWM: valor lógico de la bobina, duty y estado físico del pin',[
 'Son tres cosas distintas y conviene no mezclarlas:',
 LI('<b>Valor lógico de la bobina</b> (lo que ve el programa/Monitor): un booleano calculado por el programa.'),
 LI('<b>Duty PWM</b>: el valor 0–4095 que entrega el bloque PWM (5 kHz, 12 bits). Es una relación de trabajo, no un nivel.'),
 LI('<b>Estado físico del pin</b>: bajo PWM el pin sigue al duty del periférico LEDC; la escritura digital de esa salida se ignora mientras el pin está marcado como PWM.'),
 'Por eso una salida con PWM <b>no debe describirse como una salida digital permanentemente alta o baja</b>: conmuta a 5 kHz con el ancho de pulso del duty. El simulador del editor representa la salida como encendida cuando el duty supera 2048 (diferencia visual conocida); el valor lógico del firmware y el del simulador no tienen por qué coincidir en una salida PWM.',
 '<b>Qué se verificó:</b> la lógica del bloque PWM y su conversión a Ladder (host). <b>Qué NO se verificó:</b> el comportamiento eléctrico del pin en un ESP32 real (la regla "el pin bajo PWM ignora la escritura digital" se conoce por lectura de plc_io.cpp, no por ejecución en hardware).']))
log('Cap. 6','6.1 / PWM','Documentado','Diferencia entre valor lógico, duty y estado físico del pin; PWM nunca se describe como salida digital fija; qué se verificó y qué no.')
# 6.2 umbrales
rep(570,'→ Entonces CMP < 1474 (equivale a < 18°C sin SCALE)','→ Entonces CMP < 1474 (aproximadamente 18°C; el valor exacto depende del redondeo)')
replace_block(580,MONO('''  Si el sensor es 0-10V = 0-50°C:
  18°C → ADC = (18/50) × 4095 = 1474,2 → el ADC solo da enteros: 1474
  25°C → ADC = (25/50) × 4095 = 2047,5 → 2047 / 2048

  Con SCALE (0-4095 → 0-50) y división entera truncada:
  ADC 1474 → 17     ADC 1475 → 18     ADC 2129 → 25     ADC 2130 → 26
  Entonces:  CMP < 18 se activa con temperatura  < 18,0 °C   (ADC ≤ 1474)
             CMP > 25 se activa con temperatura ≥ 26,0 °C   (ADC ≥ 2130)
  La histéresis efectiva es 18 °C → 26 °C, no 18 → 25.

  Para resolución de décimas de grado: SCALE con outMax=500 y CMP < 180 / CMP > 250
  (resolución 0,1 °C). Fórmula general: ADC_umbral = (T_umbral / T_max_sensor) × 4095'''))
log('Cap. 6','6.2','Corregido','Umbrales por truncamiento del SCALE: CMP>25 recién actúa a ≥26 °C; el valor "1474 = 18 °C" se leía como 17. Se documenta y se propone SCALE 0–500 (décimas).')
rep(594,'¿Qué nivel de compatibilidad Ladder tiene ahora?','¿Se puede ver el Ladder equivalente en el editor? Probarlo.')
after(591,V3(['Con SCALE entero (0–100) los umbrales efectivos pueden correrse hasta 1 punto porcentual por el truncamiento: la tabla vale para los niveles indicados por rango, no para el valor exacto del límite.'],'Aclaración v3 — truncamiento'))
# 6.4 comparador doble
replace_block(600,MONO('''  ┌──────┐  ┌────────────────────────────────┐
  │ AI1  ├──┤ SCALE 0-4095 → 0-100 (décimas) ├──┬──────────────────────────────
  └──────┘  └────────────────────────────────┘  │       (100 = 10,0 kg)
                                                ├──► [CMP < 20] ──A─┐
                                                │                    ├──►[OR]──►[OUT1] (Separador)
                                                └──► [CMP > 50] ──B─┘
                                                              OR ──► [NOT] ──► [OUT2]  (Pieza OK)

  CMP<20: Q=1 si peso < 2,0 kg (liviana)
  CMP>50: Q=1 si peso > 5,0 kg (pesada)
  OR: Q=1 si CUALQUIER condición de rechazo es verdadera → separador activo
  NOT(OR): Q=1 si la pieza está DENTRO del rango → OUT2 (pieza buena)

  Ventana de aceptación: [2,0 kg, 5,0 kg]   (resolución de 0,1 kg por el truncamiento del SCALE)
  '''+OKL))
after(600,V3(['Con SCALE 0–10 (kg enteros) el truncamiento hacía que 5,5 kg y 5,99 kg se leyeran como 5 y pasaran como BUENAS: la tabla del v2 solo se cumplía porque los pesos de prueba eran 1,5/2,0/3,5/5,0/6,2. Se escala a 0–100 (décimas de kg) y se compara con CMP<20 y CMP>50.'],'Corrección v3 — Ejemplo 6.4'))
settable(602,[['<b>Peso (ideal)</b>','<b>Valor del SCALE</b>','<b>CMP&lt;20</b>','<b>CMP&gt;50</b>','<b>OUT1 (separador)</b>','<b>OUT2 (OK)</b>'],
 ['1,5 kg (liviana)','15','1','0','1 (ACTIVO)','0'],['1,99 kg','19','1','0','1 (ACTIVO)','0'],['2,0 kg (límite inf.)','20','0','0','0','1 (BUENA)'],['3,5 kg (buena)','35','0','0','0','1 (BUENA)'],
 ['5,0 kg (límite sup.)','50','0','0','0','1 (BUENA)'],['5,5 kg (pesada)','55','0','1','1 (ACTIVO)','0'],['6,2 kg (pesada)','62','0','1','1 (ACTIVO)','0']],[110,70,60,60,90,70])
log('Cap. 6','6.4','Corregido','SCALE 0–100 (décimas de kg) con CMP<20 y CMP>50; la tabla se recalculó con la aritmética del SCALE (valores calculados, no medidos). Antes 5,5 y 5,99 kg pasaban como BUENAS.')
replace_block(604,MONO('''  Sensor: 0-10V = 0-10 kg (escala lineal, 1V por kg)
  2 kg → 2V → ADC = (2/10) × 4095 = 819
  5 kg → 5V → ADC = (5/10) × 4095 = 2047,5

  Con SCALE (outMin=0, outMax=100): CMP con values 20 y 50 (décimas de kg).
  Sin SCALE: CMP con values ≈819 y ≈2047 (en ADC; el umbral exacto depende del redondeo).'''))
rep(606,'Calcular los valores ADC correspondientes.','Calcular los valores de CMP (en décimas de kg: 30 y 70) y los ADC correspondientes.')
# 6.5 título
replace_block(609,{'t':'extitle','x':'<b>Ejemplo 6.5 — Control de temperatura con zona neutra y dos actuadores </b>'})
# resumen
rows=[list(r) for r in B[625]['rows']]
for r in rows[1:]:
    k=re.sub('<[^>]+>','',r[0]).strip() if False else r[0]
    if k=='AI1': r[2]='✅ Sí (fila numérica)'
    elif k=='SCALE': r[2]='✅ Sí (fila numérica)'
    elif k=='CMP': r[2]='✅ Sí (fuente numérica)'
    elif k=='PWM': r[2]='✅ Sí (fila numérica)'
    elif k.startswith('SR/RS'): r[2]='✅ Sí'
settable(625,rows,B[625].get('w'))
log('Cap. 6','Resumen','Corregido','La tabla de compatibilidad Ladder del resumen ya no marca AI1/SCALE/CMP/PWM como "Level 3 no convertible".')
