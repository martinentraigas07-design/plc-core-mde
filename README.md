# PLC-CORE-MDE

**PLC modular abierto basado en ESP32 con programación FBD + Ladder, simulador web y arquitectura industrial escalable**

---

## 🚀 Descripción

**PLC-CORE-MDE** es un controlador lógico programable (PLC) modular, abierto y escalable, basado en ESP32, diseñado para:

* Automatización industrial
* Domótica
* Educación técnica
* Desarrollo experimental

El sistema permite programar lógica de control utilizando:

👉 **FBD (Function Block Diagram)**
👉 **Ladder (diagrama de contactos)**

Ambos basados en la norma **IEC 61131**, con conversión interna automática y consistente.

---

## 🧠 Diferencial del sistema

A diferencia de otros proyectos, PLC-CORE-MDE utiliza una arquitectura unificada basada en una:

### 🔄 Representación Intermedia (IR)

Esto permite coherencia total entre:

**FBD ↔ IR ↔ Ladder ↔ Runtime**

✔ El simulador y el firmware ejecutan el mismo modelo de evaluación (verificado con pruebas diferenciales en PC; ver "Estado de validación")
✔ FBD y Ladder compilan a la misma representación intermedia y la ejecuta el mismo runtime
✔ Permite múltiples lenguajes sobre un mismo núcleo

---

## 🌐 Simulador online

Podés probar el sistema completo directamente desde el navegador:

👉 https://martinentraigas07-design.github.io/plc-core-mde/

El simulador incluye:

* Editor FBD (Drawflow)
* Conversión a Ladder
* Runtime PLC completo en JavaScript
* Monitor en tiempo real
* Simulación de entradas/salidas
* Módulos virtuales RS485

💡 No requiere hardware

---

## ✨ Características principales

* ⚡ Núcleo basado en ESP32
* 🌐 Servidor web embebido (sin software externo)
* 🧩 Arquitectura modular RS485 / Modbus
* 🔄 Programación en **FBD y Ladder**
* 🧠 Runtime propio en C++ (PLC real)
* 🧪 Simulador web con la misma lógica que el firmware (comparación diferencial en PC; no sustituye la prueba en hardware)
* 📡 Monitor en tiempo real
* 🔍 Sistema de debug integrado
* 🔌 Detección de módulos Modbus a nivel de driver (sin probar en hardware)
* 📦 Expansión mediante módulos externos
* 🏭 Diseño para montaje en riel DIN
* 🎓 Orientado a educación técnica y uso profesional

---

## ✅ Implementado vs. 🔧 previsto

| Área | Estado | Nota |
|---|---|---|
| Editor FBD (Drawflow) | ✅ Implementado | `program.html` |
| Editor Ladder (v4) | ✅ Implementado | `ladder.html` |
| Conversión FBD → Ladder → FBD | ✅ Implementada | Convierte AI1, SCALE, CMP, PWM, BLINK, flancos y XOR. Rechaza con mensaje explícito lo que no puede convertir con fidelidad (lazos con 2 o más memorias, lazos combinacionales, entradas sin conectar, etc.) |
| Compilador a IR + verificador | ✅ Implementado | `js/compiler/` |
| Runtime determinista (C++) | ✅ Implementado | `firmware/plc_runtime.cpp`; orden por dependencias, 10 ms por scan |
| Simulador web | ✅ Implementado | `simulator/`; mismo modelo que el firmware |
| Servidor web embebido | ✅ Implementado (sin validar en hardware) | `/status`, `/nodes`, `/save`, `/load`, `/plc/*`, `/tags/*`, `/modbus/*`...; sirve FBD, Ladder v4, monitor y manual desde SPIFFS (≈0,66 MB) |
| Persistencia del programa | ✅ Implementada | Guardado transaccional (`.tmp` + renombrado) y recuperación |
| Maestro Modbus RTU (driver) | ⚠ Parcial | Existe el driver (9600 8N1, sondeo, descubrimiento 1–10, hasta 16 esclavos). **No hay nodos Modbus en el editor, el compilador ni el runtime** |
| Nodos RDI / RDO / RAI / RAO | 🔧 Previsto | No existen en el editor actual; los ejemplos del Capítulo 9 del manual son conceptuales |
| Ethernet / TCP, gateway, data logging | 🔧 Previsto | Ver "Futuro del proyecto" |

### Estado de validación

* **Validado en PC:** 33 baterías automáticas (`tests/run_all.sh`): motor, compiladores, Ladder, conversión bidireccional, persistencia, simulador vs. firmware compilado en el host, ejemplos del manual y auditoría estática. Es validación **diferencial/funcional en PC, no una prueba formal**.
* **No validado en hardware:** entradas/salidas físicas, ADC, PWM, SPIFFS, WiFi/servidor web en el ESP32, RS-485/Modbus. La lista de pruebas físicas está en `docs/Checklist_pruebas_fisicas.md`.
* **Interfaz embebida (desde E7):** `firmware/data/` contiene FBD, Ladder v4, monitor, manual y los compiladores, y se **genera** desde las páginas de la raíz con `node tools/build_web.js` (sin simulador, sin Internet). El simulador sigue disponible como aplicación aparte (`simulator/`, páginas de la raíz). Probado contra un ESP32 *simulado* a nivel HTTP; **falta probarlo en el ESP32 real** (`docs/Checklist_servidor_embebido.md`). Instrucciones: `docs/Instrucciones_carga_ESP32.md`.
* **Proyectos portables `.plc` (desde E7 FINAL):** FBD y Ladder pueden **exportar** el proyecto completo a un archivo `.plc` (JSON versionado) y **importarlo** en el simulador o en el servidor embebido del ESP32, sin Internet. Importar no guarda en el PLC: hay que pulsar «Guardar en PLC» y confirmar. Ejemplos en `examples/`; formato en `docs/Formato_proyecto_PLC.md`. Validado en PC (jsdom + firmware compilado en el host); **sin probar en el ESP32 real**.

## 🎓 Aplicaciones

* **Educativas:** aprendizaje de lógica PLC con FBD y Ladder, simulador sin hardware, y el *Manual didáctico v3* (`docs/Manual_PLC_CORE_MDE_COMPLETO_v3.pdf`) con ejercicios verificados por ejecución.
* **Automatización:** control discreto y analógico de baja complejidad (temporizadores, contadores, biestables, escalado analógico, PWM). Los ejemplos de seguridad del manual son ejercicios didácticos; **no constituyen un sistema de seguridad certificado**.

---

## 🏗 Arquitectura del sistema

### 🔹 Módulo CORE (ESP32)

* Ejecución del programa PLC
* Runtime de control
* Servidor web embebido
* Gestión de comunicaciones
* Maestro Modbus RS485 (driver; ver "Implementado vs. previsto")
* Configuración del sistema

---

### 🔹 Módulos de expansión

* Entradas digitales
* Salidas digitales
* Entradas analógicas
* Salidas analógicas
* Módulos mixtos
* Dispositivos Modbus RS485
* Futuros módulos de comunicación

---

## 🔄 Flujo de programación

El sistema trabaja con un flujo unificado:

**FBD (editor gráfico)**
→ **IR (representación interna)**
→ **Ladder (visualización industrial)**
→ **Runtime (ejecución real o simulada)**

Esto garantiza:

✔ Consistencia total
✔ Portabilidad entre simulador y hardware
✔ Base sólida para futuras expansiones (IEC 61131 completo)

---

## 🧑‍💻 Cómo empezar

### 🔹 Opción 1 — Simulador (recomendado)

Abrí directamente:

👉 https://martinentraigas07-design.github.io/plc-core-mde/

---

### 🔹 Opción 2 — PLC real

1. Compilar y grabar `firmware/PLC_CORE_MDE.ino` y subir `firmware/data/` a SPIFFS (pasos exactos en `docs/Instrucciones_carga_ESP32.md`)
2. Conectarse a la red WiFi del PLC y abrir `192.168.4.1`
3. Programar desde la interfaz web

---

## 📂 Estructura del repositorio

```
firmware/              → Runtime PLC (ESP32)
firmware/data/         → Interfaz embebida (SPIFFS) — GENERADA por tools/build_web.js
examples/              → Proyectos de ejemplo .plc (FBD y Ladder)
js/project/            → Formato de proyecto portable .plc (plc_project.js)
tools/                 → build_web.js: construye firmware/data/ desde la raíz
web_legacy_E6/         → Interfaz embebida anterior (E6), conservada sin usar
js/                    → Compiladores, decompilador Ladder, API, verificador IR
simulator/             → Simulador web
*.html                 → Editores FBD / Ladder, monitor, manual (versión web)
tests/                 → Pruebas automáticas de host (no son pruebas del ESP32)
docs/                  → Manual didáctico v3, informes, checklist de pruebas físicas
hardware/              → Esquemáticos y PCB
CHANGELOG.md · VERSION → Historial y versión propuesta
```

---

## 🎯 Objetivos del proyecto

PLC-CORE-MDE está diseñado para:

* Educación técnica en automatización
* Aprendizaje de lógica PLC (FBD / Ladder)
* Desarrollo de sistemas de control personalizados
* Proyectos de bajo costo
* Experimentación con arquitectura industrial
* Formación en IEC 61131

---

## 🔮 Futuro del proyecto

* Simulación híbrida (PLC real + virtual)
* Comunicación Ethernet / TCP
* Gateway industrial
* Monitoreo remoto
* Registro de datos (data logging)
* Paneles web de visualización
* Soporte multi-dispositivo

---

## 👤 Autor

**Martín Entraigas** - **MDE-ELECTRONICA**
Argentina

Proyecto enfocado en educación técnica, automatización y desarrollo abierto.

---

## 🔐 Licencia

**PLC-CORE-MDE License v1.0**

* ✔ Uso educativo permitido
* ⚠ Uso comercial requiere autorización
* ✔ Modificaciones permitidas bajo condiciones

Ver archivo `LICENSE` para más detalles.
