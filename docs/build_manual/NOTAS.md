# E5 notas de trabajo (pipeline)
- extract.py -> raw.json ; normalize.py -> blocks.json ; blocks.txt (índice #N por bloque) ; render.py (reportlab) ; faithful.pdf = re-render sin correcciones (fidelidad ok: 42 palabras de 29888 faltan)
- Próximo: examples (tests/t_e5_manual.js genera man_build/e5_results.json con tablas ejecutadas) + patches.py (aplica correcciones por índice y genera registro de cambios) + build final docs/Manual_PLC_CORE_MDE_COMPLETO_v3.pdf + informe
- Cap.9: firmware tiene master Modbus (plc_modbus.cpp, arrays rdi/rdo/rai/rao) pero runtime/editor/compilador NO tienen nodos RDI/RDO/RAI/RAO -> ejemplos no ejecutables
