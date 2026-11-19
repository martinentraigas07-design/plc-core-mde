# -*- coding: utf-8 -*-
# Capítulo 11, Apéndice A y Glosario
replace_block(920, {'t':'chtitle','x':'<b>Capítulo 11 — Diagnóstico y Resolución de Problemas </b>'})

# 11.4 tabla de síntomas
rows=[r[:] for r in B[936]['rows']]
for r in rows:
    if r[0].startswith('Motor no se mantiene'):
        r[1]='Falta memoria (SR/RS) o el pulsador de paro está mal conectado'
        r[2]='Editor: verificar que hay un SR/RS entre el pulsador y OUT. Monitor: Q de la memoria'
        r[3]='Agregar RS con S=arranque y R=NOT(paro NC) (ver Cap. 2.1)'
    elif r[0].startswith('Contador cuenta varias'):
        r[0]='Contador cuenta de más por cada pulso físico'
        r[1]='Rebote mecánico del pulsador/sensor (el CTU ya cuenta solo flancos 0→1)'
        r[2]='Monitor: observar CV con un único pulso'
        r[3]='Filtrar con TON (antirrebote ~50 ms) o usar sensor sin rebote. R_TRIG antes del CTU es redundante'
    elif r[0].startswith('Toggle'):
        r[1]='Sin R_TRIG el toggle se invierte en cada scan mientras el pulsador está presionado'
        r[2]='Monitor: OUT1 oscila a ~50 Hz (scan de 10 ms)'
        r[3]='Agregar R_TRIG sobre el pulsador (ver Cap. 2.2 / 3.4)'
    elif r[0].startswith('PWM no genera'):
        r[1]='La misma OUT está usada también como salida digital (la salida PWM tiene prioridad en el pin)'
        r[2]='Editor: verificar que la salida no está duplicada. Medir con osciloscopio/multímetro de duty'
        r[3]='Usar solo PWM o solo salida digital en esa OUT. (Comportamiento deducido de la lectura del código; no probado en ESP32)'
settable(936,rows,B[936]['w'])
after(936, WARN('Realimentación y orden de evaluación',[
 'Si un programa con un lazo de realimentación se comporta distinto al esperado, revisá si el lazo contiene dos o más bloques de memoria (SR, RS, TON, TOF, TP, contadores, flancos). En ese caso el resultado puede depender del orden de evaluación interno (identificadores de nodo). Ver Apéndice B.']))
log('Cap. 11','11.4','Corregido','Síntomas: "Falta bloque SR" → memoria SR/RS con paro NC; regla R_TRIG/CTU falsa → rebote; toggle "100 Hz" → ~50 Hz; PWM con nota de que no fue probado en ESP32.')

# 11.5 RDI/RDO
rep(938,'RDI/RDO no aparecen en el editor','[Conceptual] Los nodos RDI/RDO no existen en el editor')
rep(938,'Módulo no configurado en TAGS','El firmware actual no define nodos remotos en el editor/compilador')
rep(938,'RDI siempre en 0 aunque entrada activa','[Conceptual] Valor remoto siempre en 0')
rep(938,'RAI1 muestra valores incorrectos','[Conceptual] Valor analógico remoto incorrecto')
after(938, WARN('Modbus: estado real de la implementación',[
 'Esta tabla describe síntomas típicos de un bus RS-485/Modbus en general. En esta versión del firmware el maestro Modbus existe a nivel de driver, pero no hay nodos RDI/RDO/RAI/RAO en el editor, el compilador ni el runtime. Los síntomas de cableado (terminación, GND, cortocircuito) sí aplican al bus; los de "nodos remotos" son conceptuales y no fueron verificados en hardware.']))
log('Cap. 11','11.5','Aclarado','RDI/RDO/RAI/RAO marcados como conceptuales; se agrega aviso del estado real de Modbus.')

# Caso 1 y 2
rep(945,'→ Editor: ¿hay bloque SR? ¿IN1 conectado a S? ¿IN2 conectado a R?','→ Editor: ¿hay bloque RS? ¿IN1 (arranque) a S? ¿NOT(IN2) a R? (paro NC: 1 en reposo)')
rep(945,'¿IN2 está en 1 en reposo? Si NO: botón de paro NC no conectado o\ninvertido.','¿IN2 está en 1 en reposo? Si NO: botón de paro NC no conectado o\ninvertido (con RS(S=IN1, R=NOT IN2) un paro abierto mantiene el motor apagado: es el comportamiento seguro).')
rep(945,'¿Q del SR cambia a 1?','¿Q de la memoria cambia a 1?')
rep(945,'Si sí pero OUT1 no cambia: ¿Q del SR conectado a OUT1?','Si sí pero OUT1 no cambia: ¿Q de la memoria conectado a OUT1?')
rep(945,'entre SR y OUT1','entre la memoria y OUT1')
rep(947,'Puede ser una memoria SR que\n     arranca en 1 si hubo un SET previo guardado en EEPROM.','Puede ser una memoria o una\n     entrada que ya vale 1 al encender (el código del firmware no guarda el estado de las memorias de forma persistente; no verificado en placa).')
rep(953,'□ Hay R_TRIG antes de cada CTU','□ Los contadores reciben pulsos limpios (sin rebote); el CTU/CTD cuenta solo flancos')
rep(953,'□ En el Monitor: la lógica interna (SR, timers) responde correctamente','□ En el Monitor: la lógica interna (memorias, timers) responde correctamente')
log('Cap. 11','11.6','Corregido','Casos de diagnóstico y checklist: memoria RS con NOT(paro NC); se elimina "R_TRIG antes de cada CTU"; sin EEPROM para estados de memoria.')

# Apéndice A.1: columna Ladder
rows=[r[:] for r in B[956]['rows']]
mp={'IN1':'✓ contacto','IN2':'✓ contacto','OUT1..OUT4':'✓ bobina','AI1':'✓ fila numérica','AND':'✓ serie','OR':'✓ paralelo','NOT':'✓ contacto NC',
 'XOR':'✓ se expande a contactos','CMP':'✓ fila numérica (fuente INT)','TON':'✓ bloque','TOF':'✓ bloque','TP':'✓ bloque','BLINK':'✓ bloque',
 'CTU':'✓ bloque','CTD':'✓ bloque','SR':'✓ (lazos: ver Apéndice B)','RS':'✓ (lazos: ver Apéndice B)','R_TRIG':'✓ [P]','F_TRIG':'✓ [N]','SCALE':'✓ fila numérica','PWM':'✓ fila numérica'}
for r in rows[1:]:
    r[-1]=mp[r[0]]
rows[0][-1]='<b>Ladder (v3)</b>'
settable(956,rows,B[956]['w'])
after(956, P('Los bloques con ✓ se convierten a Ladder con la herramienta actual y fueron validados por pruebas diferenciales firmware/simulador (no es una prueba formal de equivalencia). Se rechazan: lazos combinacionales, lazos de realimentación con 2 o más bloques de memoria, AND con entrada sin conectar, detectores de flanco sin entrada, CMP sobre fuente booleana, PWM sin entrada y valores numéricos hacia entradas booleanas. Los nodos RDI/RDO/RAI/RAO no existen.'))

# A.2 ciclo de scan
settable(958,[['<b>Fase</b>','<b>Operación</b>','<b>Detalle</b>'],
 ['1','Leer entradas','IN1(GPIO21), IN2(GPIO19), AI1(GPIO36)']],[15,30,55])
settable(959,[['<b>Fase</b>','<b>Operación</b>','<b>Detalle</b>'],
 ['2','Ordenar nodos','Orden de dependencias (Kahn); desempate por menor ID. Los lazos se cortan en el pivote (la memoria de menor ID): sus aristas del lazo leen el valor del scan anterior'],
 ['3','Evaluar cada nodo una vez','AND, OR, NOT, XOR, CMP, timers, contadores, memorias, flancos y SCALE, en ese orden; cada nodo ve los valores ya calculados de sus entradas'],
 ['4','Salidas PWM','Actualizar duty cycle (5 kHz, 12 bit)'],
 ['5','Salidas físicas','OUT1(14), OUT2(27), OUT3(26), OUT4(25)']],[12,28,60])
after(959, P('Nota v3: la versión anterior describía fases fijas por tipo de bloque y un "snapshot del ciclo anterior" para todos los bloques. Eso no es lo que hace el motor: cada nodo se evalúa una sola vez por scan en orden de dependencias, y solo las conexiones que cierran un lazo leen el valor del scan anterior.'))
log('Apéndice A.2','A.2','Corregido','Ciclo de scan: se reemplaza el modelo de fases y "snapshot" por el modelo real (orden de dependencias, corte de lazo en el pivote).')

# A.3 clasificación
settable(961,[['<b>Categoría</b>','<b>Descripción</b>','<b>Bloques / casos</b>'],
 ['✓ Convertible','Conversión automática validada (pruebas diferenciales)','IN1, IN2, OUT1-4, AND, OR, NOT, TON, TOF, TP, BLINK, CTU, CTD, SR, RS, R_TRIG, F_TRIG; AI1, SCALE, CMP y PWM como filas numéricas'],
 ['✓ Se expande','Se traduce a una combinación de contactos','XOR'],
 ['✗ Rechazado (por estructura)','El conversor se niega y explica el motivo','Lazos combinacionales; lazos con 2 o más bloques de memoria; AND con entrada sin conectar; flanco sin entrada; CMP sobre booleano; PWM sin entrada; numérico hacia entrada booleana'],
 ['✗ No existe','No están implementados en el editor','RDI, RDO, RAI, RAO']],[22,34,44])
rep(960,'A.3 — Compatibilidad FBD → Ladder','A.3 — Compatibilidad FBD → Ladder (v3)')
log('Apéndice A.3','A.3','Corregido','Se reemplaza la clasificación Level 1/2/3 por la capacidad real del conversor.')

# A.8 normas
rep(972,'FBD y Ladder. Snapshot, tipos BOOL/INT.','FBD y Ladder. Tipos BOOL/INT. (El modelo de evaluación del PLC-CORE-MDE es propio: no implementa un "snapshot" IEC.)')
rep(972,'Bus: 2 hilos, hasta 32 nodos, 1200m.','Bus: 2 hilos, hasta 32 cargas unitarias y 1200 m según el estándar; el driver del PLC-CORE-MDE admite como máximo 16 esclavos.')
rep(972,'Principios de diseño seguro aplicados en Capítulo 8.','Los ejemplos del Capítulo 8 son ejercicios didácticos y NO constituyen una aplicación certificada de estas normas.')

# Glosario
rep(986,'leer entradas → ejecutar lógica → escribir salidas.','leer entradas → evaluar cada nodo una vez en orden de dependencias → escribir salidas.')
rep(1029,'Implementado en OUT1-OUT4 del PLC-CORE-MDE.','En el PLC-CORE-MDE la señal PWM es de 5 kHz y 12 bit; el valor lógico de la bobina no es el duty ni el estado físico instantáneo del pin.')
rep(1031,'Indispensable antes de CTU. Ladder: [P].','Útil para toggle y para contar eventos sostenidos; antes de un CTU es redundante (el CTU ya cuenta solo flancos). Ladder: [P].')
rep(1032,'Nodos de entrada/salida analógica remota en el editor FBD. Leen/escriben registros Modbus.','Concepto de entrada/salida analógica remota por Modbus. No existe como nodo en el editor actual.')
rep(1033,'Nodos de entrada/salida digital remota. Leen/controlan módulos de expansión RS-485.','Concepto de entrada/salida digital remota por RS-485. No existe como nodo en el editor actual.')
replace_block(1042, P('<b>Orden de evaluación / corte de lazo</b> Cada nodo se evalúa una vez por scan en orden de dependencias. En un lazo de realimentación, las conexiones salientes del pivote (memoria de menor ID) leen el valor del scan anterior. Con una sola memoria en el lazo el resultado no depende de los ID; con dos o más sí (ver Apéndice B).'))
log('Glosario','Glosario','Corregido','Se reemplaza "Snapshot IEC 61131-3" por "Orden de evaluación / corte de lazo"; R_TRIG, PWM, RAI/RAO, RDI/RDO y Ciclo de scan corregidos.')

# Apéndice B
after(1056,
 {'t':'pagebreak'},
 {'t':'chtitle','x':'<b>Apéndice B — Limitaciones documentadas y ejercicios no convertibles </b>'},
 H2('B.1 — Realimentación y orden de evaluación'),
 P('El motor evalúa cada nodo una vez por scan (10 ms) en orden de dependencias; los empates se resuelven por el menor identificador (ID) interno. Cuando hay un lazo de realimentación, el motor lo corta en el pivote (la memoria de menor ID) y las conexiones salientes del pivote dentro del lazo leen el valor del scan anterior.'),
 LI('Lazo con exactamente 1 bloque de memoria: el resultado no depende de los ID. Es convertible a Ladder y la conversión se valida estructuralmente.'),
 LI('Lazo con 2 o más bloques de memoria: el comportamiento depende de los ID internos, que el usuario no controla. El conversor Ladder lo rechaza con un mensaje explícito; no se sustituyen bloques por contactos falsos.'),
 LI('Lazo combinacional (sin memoria): rechazado.'),
 P('Esto reemplaza la afirmación de la edición anterior de que el PLC usaba un "snapshot IEC 61131-3": esa afirmación era falsa.'),
 H2('B.2 — Ejercicios del manual y su estado'),
 TBL([['<b>Ejercicio</b>','<b>Estado en Ladder</b>','<b>Motivo</b>'],
  ['2.2 Toggle (realimentación)','Convertible','1 memoria en el lazo'],
  ['3.4','Convertible','1 memoria en el lazo'],
  ['5.5 Cascada de contadores','Convertible','Con OR en R'],
  ['2.4 Enclavamiento mutuo (RS + SR)','No convertible','2 memorias en el lazo; ganador indefinido según ID'],
  ['8.3 Alarma enclavada (TON + RS ± SR)','No convertible','2 memorias en el lazo'],
  ['10.5 Sistema completo','No convertible','6 memorias en el lazo'],
  ['Versiones originales de 7.4 y 10.x','Reemplazadas','Entrada AND sin conectar / detector de flanco sin entrada: el compilador las rechaza']],[34,22,44]),
 P('En los ejercicios no convertibles el programa FBD sigue siendo válido y se ejecuta en el PLC y en el simulador; lo que no se ofrece es la vista Ladder automática. En la ejecución local (firmware compilado en el host y simulador) 40 permutaciones de ID de los casos 8.3 y 10.5 no cambiaron el resultado; esto es una evidencia, no una prueba.'),
 H2('B.3 — PWM'),
 P('El PWM trabaja a 5 kHz y 12 bits. Hay que distinguir el valor lógico de la bobina, el duty y el estado físico del pin. No debe describirse como salida digital permanentemente alta o baja. Que el pin ignore la escritura digital cuando es PWM se conoce por lectura del código; no fue probado en una placa ESP32.'),
 H2('B.4 — Modbus'),
 P('El maestro Modbus existe a nivel de driver (9600 8N1, sondeo ≈100 ms, descubrimiento 1–10, máximo 16 esclavos). No hay nodos Modbus en el editor, el compilador ni el runtime. Todos los ejemplos del Capítulo 9 y los RDI/RDO/RAI/RAO son conceptuales y no fueron verificados en hardware.'),
 H2('B.5 — Qué NO se verificó'),
 LI('No se probó ningún ejemplo en hardware ESP32.'),
 LI('No se realizaron pruebas Modbus ni RS-485 reales.'),
 LI('Los resultados de los ejemplos provienen del firmware compilado en el host y del simulador real; la equivalencia se comprobó de forma diferencial, no formal.'),
 LI('Los ejemplos de seguridad (Cap. 8) son ejercicios didácticos; no sustituyen un circuito de seguridad certificado.'))
