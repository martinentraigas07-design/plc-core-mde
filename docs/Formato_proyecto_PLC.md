# Formato de proyecto portable `.plc` — `plc_project`, versión 1

**Qué es:** un archivo JSON (extensión `.plc`) que guarda un proyecto completo de PLC-CORE-MDE para llevarlo entre el simulador web y el servidor embebido del ESP32, o archivarlo. **Qué no es:** no es PLCopen XML ni IEC 61131-10, y **no reemplaza** el formato interno del firmware (el envelope `plc_program` que se envía a `/save`). El `.plc` es un contenedor externo: se valida y se **recompila** antes de enviar nada al PLC.

## Estructura
```json
{
  "format": "plc_project",
  "formatVersion": 1,
  "generator": { "name": "PLC-CORE-MDE", "toolVersion": "6.2.0-rc.1", "origin": "simulator" },
  "project":   { "name": "Control Tanque (FBD)", "description": "" },
  "editor":    "fbd",                       // "fbd" | "ladder"
  "compat": {
    "target": "PLC-CORE-MDE",
    "envelope": { "format": "plc_program", "version": 2 },   // 2 = FBD, 3 = Ladder
    "irVersion": 4, "ladderFormatVersion": null, "maxNodes": 64
  },
  "diagram": { "fbd": { "drawflow": { "Home": { "data": { ... } } } } },
  //          o { "ladder": { "formatVersion": 4, "rungs": [ ... ] } }
  "ir": { "format": "ir", "meta": {...}, "memory": {...}, "program": { "nodes": [...] }, "order": [...] },
  "symbolTable": { ... },
  "checksum": { "algorithm": "crc32", "covers": "diagram+ir", "value": "583c78d8" }
}
```
- **`diagram`** es la fuente de verdad editable: el export de Drawflow (FBD) o los renglones (Ladder v4).
- **`ir`** es una caché informativa del programa compilado. **Nunca se envía al PLC**: al importar, el editor recompila el diagrama con su propio compilador y compara con este IR (`La compilación coincide con la del archivo`); si difiere, avisa y usa siempre la recompilación. Puede ser `null` (por ejemplo, si el programa aún no compila al exportar).
- **Sin estado de ejecución:** no hay valores de entradas/salidas, timers ni contadores, ni fechas. Dos exportaciones del mismo programa dan el mismo archivo byte a byte.
- **`checksum`** (CRC-32 sobre `diagram` + `ir`) detecta corrupción o ediciones manuales. **No es una firma ni protege contra un atacante**: por eso la seguridad no depende de él (ver abajo).

## Versionado y compatibilidad
- `formatVersion` > 1 (archivo de una versión futura) → se rechaza con un mensaje; no se intenta abrir parcialmente.
- Campos desconocidos se ignoran. Un cambio incompatible del formato incrementará `formatVersion`.
- Archivos anteriores que **también** se aceptan al importar (con advertencia, sin suma de verificación): JSON Ladder exportado (`format:"ladder-pro"`) y envelopes `plc_program` guardados en el PLC.

## Validación al importar (en este orden; cualquier falla = rechazo, sin cambios)
1. **Tamaño** ≤ 262 144 bytes (se comprueba antes de leer el archivo).
2. **JSON válido** y objeto. Se rechazan claves `__proto__`/`constructor`/`prototype`, anidamiento > 40, números no finitos.
3. **Identidad y versión:** `format`, `formatVersion`, `editor`, `compat.target`.
4. **Diagrama FBD:** ≤ 64 nodos (el firmware ignoraría los sobrantes en silencio; aquí se rechaza), tipos de nodo de la lista conocida (24), `id` = clave, `typenode` apagado, `class` restringida, puertos `input_N/output_N`, conexiones solo a nodos existentes, `data` con valores simples y **HTML de nodo con lista blanca estricta** (solo `div, br, select, option, input` y atributos `style/class/value/type=number/df-*`; nada de `script`, `on*`, `href`, `src`, `iframe`, `svg`, `url()`…). Drawflow inserta ese HTML con `innerHTML`, por eso se rechaza cualquier cosa fuera de la lista en lugar de "limpiarla".
5. **Diagrama Ladder:** ≤ 128 renglones, nombres de campo y valores de identificadores (`var`, `id`, `op`, …) restringidos, formato ≤ el del editor.
6. **Suma de verificación** (si falta: advertencia).
Luego el editor muestra un resumen y **pide confirmación** antes de reemplazar el diagrama abierto. Si la reconstrucción falla a mitad, se restaura el diagrama anterior.

## Importar nunca toca el PLC
Importar solo reconstruye el **editor**. El programa guardado en el ESP32 no cambia hasta que se pulsa **Guardar en PLC** y, tras una importación, se acepta el aviso «Vas a REEMPLAZAR el programa guardado…». Guardar compila, valida (`PlcSymbolTable.validate`) y recién entonces envía por `/save` (transaccional en el firmware). En el simulador el aviso y los mensajes dicen «PLC SIMULADO (no es hardware)».

## Cruce entre editores
- `.plc` FBD en el editor FBD: restaura el diagrama idéntico. `.plc` Ladder en Ladder: restaura los renglones.
- `.plc` FBD en Ladder: se compila y se **convierte** con el decompilador existente (con sus rechazos estructurales: p. ej. dos memorias en lazo); si no es convertible se rechaza con los motivos y no cambia nada.
- `.plc` Ladder en FBD: se rechaza con aviso (se abre en el editor Ladder).

## Límites y limitaciones
- Máximo 64 nodos (= `MAX_NODES` del firmware) y 128 renglones; archivo ≤ 256 KiB.
- Las **etiquetas de IO (TAGS)** del PLC no forman parte del `.plc` (se guardan aparte en el dispositivo).
- Una exportación hecha desde un programa que aún no compila se guarda **sin IR** (se informa); se puede abrir y corregir.
- El CRC-32 no es criptográfico; el archivo no está cifrado ni firmado.
- No se garantiza apertura en versiones futuras con `formatVersion` mayor.
