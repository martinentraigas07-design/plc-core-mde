# -*- coding: utf-8 -*-
from pl import *
LADDER_OK_TXT='✓ Conversión FBD → Ladder: soportada. Validada con pruebas diferenciales (firmware y simulador); no es una prueba formal de equivalencia.'
# ---- portada / índice / nota de revisión ----
rep(3,'Manual Completo — Capítulos 1 al 11','Manual Completo — Capítulos 1 al 11 · Edición corregida v3')
after(7,P('<b>Edición corregida v3.</b> Esta edición reconstruye el Manual v2 (el PDF original no se modificó) con los errores detectados en la auditoría corregidos y los ejemplos verificados por ejecución sobre el firmware (compilado en PC) y el simulador del proyecto. <b>No se realizaron pruebas en hardware ESP32.</b>'))
setx(10,'1   Conexiones Básicas 2   Control Arranque / Paro y Memoria 3   Memoria y Enclavamiento — SR, RS, F_TRIG 4   Temporizadores — TON, TOF, TP, BLINK 5   Contadores — CTU, CTD 6   Señales Analógicas — AI1, SCALE, CMP, PWM 7   Automatización Industrial (ejercicios didácticos) 8   Circuitos de Seguridad (ejercicios didácticos) 9   Expansión RS-485 / Modbus RTU (conceptual) 10   Sistemas Completos 11   Diagnóstico y Resolución de Problemas A   Apéndice — Referencia Rápida B   Limitaciones documentadas y ejercicios no convertibles C   Registro de cambios de la edición v3 G   Glosario Técnico')
after(10,
 {'t':'chtitle','x':'<b>Nota de revisión — Edición v3 </b>'},
 P('Esta edición conserva la orientación didáctica, la organización por capítulos y los diagramas del Manual v2, y corrige los errores que se detectaron al ejecutar cada ejemplo. Los cambios importantes están marcados con recuadros: <b><font color="green">✔ Corrección v3</font></b> (qué se corrigió y por qué), <b><font color="orange">⚠ Limitación</font></b> (lo que el sistema no hace o no garantiza) e <b><font color="blue">ℹ Nota</font></b> (aclaraciones). El detalle completo está en el Apéndice C.'),
 H2('Cómo se verificaron los ejemplos'),
 P('Cada ejemplo corregido se ejecutó con dos motores independientes: el <b>firmware real (plc_runtime.cpp) compilado en una PC con capas de compatibilidad Arduino</b> y el <b>simulador del editor</b>, exigiendo que ambos den exactamente las mismas salidas. Las tablas de estados de los ejemplos corregidos salen de esas ejecuciones. La conversión FBD → Ladder se validó con pruebas diferenciales (mismas entradas, mismas salidas); <b>eso no equivale a una demostración formal de equivalencia</b>.'),
 CALL('Lo que NO se verificó',[LI('<b>No se probó nada en un ESP32 real</b>: ni entradas/salidas físicas, ni tiempos reales de scan, ni el PWM sobre el pin.'),LI('<b>No hay pruebas de comunicación Modbus</b> con módulos físicos (ver Capítulo 9).'),LI('Los ejemplos con cables, contactores y pulsadores son circuitos de enseñanza; el cableado real debe revisarlo una persona competente.')],'warn'),
 H2('Ejercicio didáctico no es función de seguridad'),
 P('Los ejemplos de paro, emergencia, enclavamiento y timeout (Capítulos 2, 3, 7, 8 y 10) son <b>ejercicios didácticos</b> para aprender lógica de control. El PLC-CORE-MDE es una plataforma educativa: <b>no está certificado ni validado como función de seguridad (SIL/PL)</b>. Una parada de emergencia real debe cortar la energía de potencia con hardware dedicado (relé de seguridad, contactores con contactos guiados, etc.), independiente de este PLC.'),
 H2('Convención de pulsadores usada en todo el manual'),
 P('Un pulsador <b>NA</b> (normalmente abierto) entrega IN=1 solo mientras se lo presiona. Un pulsador <b>NC</b> (normalmente cerrado) entrega IN=1 <b>en reposo</b> y IN=0 al presionarlo (o si se corta el cable). Por eso, un paro NC <b>no se conecta directamente</b> a la entrada R de un bloque de memoria: hay que invertirlo con un NOT (R = NOT IN2). Este fue el error más frecuente del Manual v2 y está corregido en cada ejemplo afectado.'))
log('Portada','—','Agregado','Nota de revisión v3, alcance de las pruebas, convención NA/NC y aclaración "ejercicio didáctico ≠ función de seguridad".')
# ---- intro duplicada (p.3 y p.4 del original): se conserva la versión completa de p.4 ----
for i in (11,12,13,14,15): delete(i)
log('Introducción','—','Eliminado','Se eliminó la introducción duplicada de la página 3 (idéntica en contenido a la de la página 4, que es la versión completa).')
rep(21,'RS-485 / Modbus RTU — bus industrial para módulos de expansión','RS-485 / Modbus RTU — el firmware incluye un maestro Modbus a nivel de driver; el editor/compilador todavía no tienen bloques para usarlo (ver Cap. 9)')
# ---- tabla de bloques / compatibilidad Ladder ----

def edit_last(i,mp):
    rows=[list(r) for r in B[i]['rows']]
    for r in rows[1:]:
        k=re.sub('<[^>]+>','',r[0]).strip()
        if k in mp: r[-1]=mp[k]
    settable(i,rows,B[i].get('w'))
import re
edit_last(27,{'AI1':'✅ Sí (fila numérica)','XOR':'⚠ Se expande (AND/OR/NOT)','CMP':'✅ Sí (fuente numérica)','BLINK':'✅ Sí'})
edit_last(28,{'SCALE':'✅ Sí (fila numérica)','PWM':'✅ Sí (fila numérica)'})
after(28,WARN('Limitaciones de la conversión FBD → Ladder',[
 'No se convierten: lazos de realimentación sin ningún bloque con memoria, ni lazos con <b>dos o más</b> bloques con memoria (su comportamiento depende del orden interno de evaluación; ver Apéndice B); AND con una entrada sin conectar; detector de flanco sin entrada; CMP sobre una señal booleana; PWM sin entrada; una señal numérica conectada a una entrada booleana. Los bloques RDI/RDO/RAI/RAO <b>no existen</b> en el editor.',
 'Cuando no se puede convertir, el editor lo informa; nunca reemplaza un bloque no soportado por un contacto falso.']))
log('Introducción','Tabla de bloques','Corregido','AI1, CMP, BLINK, SCALE y PWM figuraban como "no convertible/aproximado": el decompilador actual los convierte (filas numéricas, comparador, BLINK). XOR se expande. Se agregó el recuadro de limitaciones reales.')
# ---- ciclo de scan ----
settable(31,[['<b>Fase</b>','<b>Operación</b>','<b>Detalle</b>'],
 ['1','Leer entradas físicas','IN1 (pin 21), IN2 (pin 19), AI1 (pin 36). Se toman como "foto" del scan. Para uso booleano, AI1 vale 1 si la lectura supera 2048.'],
 ['2','Evaluar cada bloque una vez, en orden de dependencias','Cada bloque (lógica, CMP, timers, contadores, memorias, flancos, SCALE) se calcula después de los bloques que lo alimentan. El orden es determinista: entre bloques listos se evalúa primero el de menor identificador interno.'],
 ['2b','Lazos de realimentación','Si hay un lazo, el motor corta una conexión: la que sale del bloque con memoria de menor identificador del lazo. Los bloques que reciben esa conexión leen el valor del scan anterior (ver Apéndice B).'],
 ['3','Actualizar registros internos de 1 scan','Se actualizan al final de la evaluación.'],
 ['4','Escribir salidas','PWM y GPIO OUT1(14), OUT2(27), OUT3(26), OUT4(25) reciben el valor calculado.']],[40,150,300])
replace_block(32,CALL('Concepto clave: orden de evaluación (corregido en v3)',[
 'El Manual v2 decía que "todos los bloques leen el estado del ciclo anterior (snapshot)". <b>Eso no es lo que hace este motor.</b> Las entradas físicas son una foto del scan, pero los bloques se evalúan <b>en orden de dependencias dentro del mismo scan</b>: un bloque ve el resultado ya calculado de los bloques que lo alimentan.',
 'Solo en un lazo de realimentación (por ejemplo, la salida de una memoria que vuelve a sus propias entradas) hay una conexión que lee el valor del <b>scan anterior</b>. El scan dura 10 ms. La elección de qué conexión se corta es determinista, pero depende de los identificadores internos de los bloques cuando el lazo tiene dos o más bloques con memoria (Apéndice B).'],'v3'))
log('Introducción','Ciclo de scan','Corregido','Se eliminó la afirmación falsa "snapshot IEC 61131-3: todos los bloques leen el ciclo anterior"; se describe el modelo real (orden de dependencias + corte del lazo en el bloque con memoria de menor ID). Tabla de fases rehecha según plcScan().')
rep(34,'para los programas compatibles','para los programas compatibles (ver limitaciones de conversión en el Apéndice B)')
