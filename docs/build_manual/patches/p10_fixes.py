# -*- coding: utf-8 -*-
rows=[r[:] for r in B[447]['rows']]
rows[-1]=['Ladder','✓ bloque','✓ bloque','✓ bloque','✓ bloque oscilador']
settable(447,rows,B[447]['w'])
rows=[r[:] for r in B[452]['rows'][:6]]
rows+=[['Sensor sostenido','Un sensor activo 50 ms = 5 scans con CU=1: el CTU suma <b>1</b> (cuenta el flanco 0→1)','El CTD resta <b>1</b> por cada flanco 0→1 de CD'],
       ['R_TRIG previo','No hace falta: el contador ya detecta el flanco. Es redundante (inofensivo)','Ídem'],
       ['Rebote','El rebote mecánico genera flancos reales: filtrar con TON o usar sensor limpio','Ídem']]
settable(452,rows,B[452]['w'])
log('Cap. 5','5.1','Corregido','Tabla de terminales: se elimina la "Regla fundamental: siempre usar R_TRIG antes del CTU" (falsa) y se reemplaza por el comportamiento verificado y la nota de rebote.')
log('Cap. 4','Resumen','Corregido','Tabla comparativa de temporizadores: fila Ladder actualizada (todos convertibles).')
