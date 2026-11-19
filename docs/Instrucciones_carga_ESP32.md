# Instrucciones de compilación y carga — PLC-CORE-MDE 6.1.0-rc.1 (E7)

> **No verificado en esta sesión:** no se pudo instalar la toolchain del ESP32 (ver `Informe_tecnico_E7.md`, sección 7). Estos pasos son el procedimiento previsto; si algún menú difiere en tu versión del IDE, anotalo en el checklist.

## 1. Requisitos
- **Arduino IDE 2.x** (o 1.8.x) o `arduino-cli`.
- Placa: paquete **"esp32" de Espressif, versión 2.0.x (probar 2.0.17)**. **No usar 3.x**: el código usa `ledcSetup/ledcAttachPin/ledcDetachPin`, que no existen en 3.x.
- Biblioteca **ArduinoJson 6.x** (p. ej. 6.21.x). **No usar 7.x.**
- Placa física: ESP32 DevKit V1 (4 MB de flash).
- Node.js ≥ 18 solo si vas a regenerar `firmware/data/` (ya viene generado).

## 2. Selección en el IDE (Herramientas / Tools)
| Opción | Valor |
|---|---|
| Placa | **ESP32 Dev Module** |
| Upload Speed | 921600 (bajar a 115200 si falla) |
| Flash Size | **4MB (32Mb)** |
| Flash Mode / Frequency | QIO / 80 MHz (DIO si hay problemas de arranque) |
| **Partition Scheme** | **Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)** — alcanza: la web ocupa ≈0,66 MB |
| Core Debug Level | None |
| Puerto | el del DevKit |

Alternativa con más margen para el programa (si el sketch no entra en 1,2 MB de APP): *No OTA (2MB APP/2MB SPIFFS)*. **No usar** *Minimal SPIFFS* (solo 190 KB de SPIFFS: no entra la web).
Si cambiás el esquema, el offset y el tamaño de SPIFFS cambian (ver 4.B).

## 3. Compilar y grabar el firmware
1. Abrir `firmware/PLC_CORE_MDE.ino` (la carpeta `firmware/` ya contiene todos los `.cpp/.h`).
2. Verificar/Compilar y **anotar** "El Sketch usa X bytes (Y %)" y "Las variables globales usan Z bytes".
3. Subir (Upload).

## 4. Cargar la interfaz web en SPIFFS (`firmware/data/`)
**A) Arduino IDE 1.8.x** con el plugin *ESP32 Sketch Data Upload*: Herramientas → *ESP32 Sketch Data Upload*. (El IDE 2.x no trae este menú; usar B.)

**B) Cualquier entorno (mkspiffs + esptool), esquema "Default 4MB with spiffs":**
```
mkspiffs -c firmware/data -b 4096 -p 256 -s 0x170000 spiffs.bin
esptool.py --chip esp32 --port <PUERTO> --baud 921600 write_flash 0x290000 spiffs.bin
```
(Los valores `0x290000` / `0x170000` son el inicio y el tamaño de SPIFFS en la tabla *default* del core 2.x; **confirmarlos** en `default.csv`, dentro de `…/packages/esp32/hardware/esp32/2.0.x/tools/partitions/`. Para otro esquema (p. ej. *No OTA*), usar el offset y tamaño de la fila `spiffs` de su `.csv`.)

Notas:
- Subir el sistema de archivos **borra el programa guardado** (`/program.json`). Hacer antes una copia: abrir `http://192.168.4.1/load` y guardar el JSON, o exportarlo desde el editor.
- El firmware monta SPIFFS con `SPIFFS.begin(true)` (formatea si no puede montar).
- Si el IDE avisa que `firmware/data` no cabe, revisar el esquema de particiones.
- `firmware/data/` se regenera con `node tools/build_web.js` (y se verifica con `--check`); no editar sus archivos a mano.

## 5. Primer arranque
1. Alimentar el PLC. Conectarse a la red WiFi **`PLC_CORE_MDE`** (clave `12345678`).
2. Abrir `http://192.168.4.1/`. Seguir `docs/Checklist_servidor_embebido.md`.
3. Si la web no carga: abrir `http://192.168.4.1/status`. Si responde JSON, el firmware corre y falta el sistema de archivos (repetir paso 4); si no responde, revisar el monitor serie a 115200.

## Proyectos `.plc` (desde E7 FINAL)
- No requieren cambios en el firmware ni en la partición: los editores de `firmware/data/` ya incluyen **Exportar proyecto / Importar proyecto**. Hay que **volver a subir SPIFFS** con la `firmware/data/` de esta versión (22 archivos) para tener los botones.
- Para probar: conectate al WiFi del PLC, abrí `http://192.168.4.1/program.html` (FBD) o `/ladder.html` y usá «Importar proyecto» con los archivos de `examples/` (están en la PC; el ESP32 no los almacena).
- Regenerar la interfaz embebida tras tocar los editores: `node tools/build_web.js` (y `--check` para verificar). Regenerar los ejemplos: `node tools/make_examples.js` (requiere jsdom).
