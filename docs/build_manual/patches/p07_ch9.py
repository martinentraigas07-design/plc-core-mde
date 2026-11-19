# -*- coding: utf-8 -*-
from pl import *
CONC='ℹ Ejemplo conceptual: los nodos RDI/RDO/RAI/RAO no existen hoy en el editor, el compilador ni el runtime;\n    no hay conversión a Ladder que evaluar.'
after(774,WARN('Estado real de la expansión Modbus en esta edición',[
 'El firmware incluye un <b>maestro Modbus RTU a nivel de driver</b> (plc_modbus.cpp/h): UART2 (TX 17, RX 16, DE 4), 9600 bps 8N1, descubrimiento de direcciones, módulos Waveshare y módulos MDE a nivel de código, y tablas de datos remotos (RDI/RDO/RAI/RAO). El sondeo se hace cada ~100 ms, <b>no en cada scan de 10 ms</b>.',
 '<b>Pero el editor FBD, el editor Ladder, el compilador y el motor de ejecución NO tienen nodos RDI/RDO/RAI/RAO</b> (se buscó en el código: no hay ninguno). Por eso <b>los ejemplos de este capítulo y las referencias a RDI/RDO/RAI/RAO de otros capítulos son conceptuales: hoy no se pueden programar ni ejecutar</b>. Tampoco se probó ninguna comunicación Modbus con módulos físicos.',
 'Úselo como material de estudio sobre RS-485/Modbus (cableado, direcciones, registros); no como una función disponible del editor.']))
log('Cap. 9','Capítulo','Agregado','Banner: el maestro Modbus existe a nivel de driver pero no hay nodos RDI/RDO/RAI/RAO en editor/compilador/runtime; ejemplos conceptuales, no hardware-verificados; sondeo ≈100 ms.')
rep(780,'En cada ciclo de scan, el PLC envía mensajes a cada esclavo (Modbus Poll).','El PLC sondea a cada esclavo periódicamente (en el firmware, cada ~100 ms; no en cada scan).')
replace_block(785,CALL('Los nodos remotos (concepto) — corregido en v3',['El Manual v2 afirmaba que "una vez configurados en el menú TAGS, los nodos RDI1, RDO1, RAI1 se usan exactamente igual que IN1, OUT1, AI1" y que "la comunicación ocurre automáticamente en cada scan". <b>Eso describe la intención de diseño, no una función disponible hoy</b>: los nodos remotos no existen en el editor ni en el runtime. Lo que sigue es el modelo conceptual de cómo se usarían.'],'warn'))
rep(786,'(Waveshare)','(Waveshare) — ejemplo conceptual')
rep(803,'Módulo de 8 salidas digitales','Módulo de 8 salidas digitales — ejemplo conceptual')
rep(812,'por Modbus','por Modbus — ejemplo conceptual')
rep(823,'variador de frecuencia','variador de frecuencia — ejemplo conceptual')
rep(835,'sistema completo','sistema completo — ejemplo conceptual')
rep(792,'El programa FBD es IDÉNTICO al Ejemplo 2.1.','El programa FBD es el del Ejemplo 2.1 CORREGIDO (RS, y con paro NC un NOT antes de R).')
rep(792,'✅ Compatibilidad Ladder: igual que el equivalente local',CONC)
rep(818,'❌ Compatibilidad Ladder: NO CONVERTIBLE (Level 3) — incluye RAI y SCALE',CONC)
rep(830,'❌ Compatibilidad Ladder: NO CONVERTIBLE (Level 3)',CONC)
rep(801,'(Respuesta: hasta 31 módulos = 248 entradas adicionales).','(Respuesta teórica del bus: hasta 31 módulos = 248 entradas. El firmware actual registra hasta 16 esclavos y descubre por defecto las direcciones 1 a 10.)')
after(830,WARN('Observación sobre este ejemplo',['El "control word" de un variador es normalmente un <b>registro</b>, no una bobina: escribirlo desde un RDO (booleano) no es correcto en un diseño real; se escribiría un registro (RAO). Los registros y escalas dependen de cada variador. Ejemplo solo conceptual.']))
log('Cap. 9','9.1–9.5','Documentado','Se marcan como conceptuales (no ejecutables ni verificados en hardware); se retiran las afirmaciones "Level 3/igual que local" para nodos inexistentes; límite real de esclavos del firmware (16, descubrimiento 1–10); 9.4: control word es un registro, no una bobina.')
