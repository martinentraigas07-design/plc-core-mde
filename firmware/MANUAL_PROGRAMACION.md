# PLC-CORE-MDE — Ejemplos de Programación
## Manual para Tecnicatura en Electrónica

---

## Introducción al entorno

El PLC-CORE-MDE se programa con el editor FBD (Function Block Diagram), uno de los 5 lenguajes definidos por la norma IEC 61131-3. Cada "bloque" representa una función: entradas físicas, operaciones lógicas, temporizadores, contadores y salidas.

**Conexión:** conectar el computador a la red WiFi `PLC_CORE_MDE` (clave: `12345678`), abrir el navegador en `192.168.4.1`.

---

## EJEMPLO 1 — Control básico de motor (Arranque/Paro)

### Situación
Una bomba de agua en una instalación rural debe activarse con un pulsador de arranque y detenerse con un pulsador de paro.

### Tags a configurar
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | PULSAR_ARRANQUE | Pulsador NA (normalmente abierto) |
| IN2 | PULSAR_PARO | Pulsador NC (normalmente cerrado) |
| OUT1 | BOMBA_AGUA | Contactor K1 — bomba 220V |

### Lógica (FBD)
```
[IN1: PULSAR_ARRANQUE] ──┐
                          ├─► [SR: MEMORIA_MOTOR] ──► [OUT1: BOMBA_AGUA]
[IN2: PULSAR_PARO]     ──┘
```

**Bloques necesarios:**
- `IN1` (PULSAR_ARRANQUE) → entrada S del bloque **SR**
- `IN2` (PULSAR_PARO) → entrada R del bloque **SR**
- Salida Q del **SR** → `OUT1` (BOMBA_AGUA)

### Concepto clave
El bloque **SR** es un biestable con **Set dominante**: cuando S=1, la salida queda en 1 aunque S vuelva a 0. Solo se apaga cuando R=1. Esto replica el circuito de automantenimiento del contactor.

### Para probar
1. Presionar IN1 brevemente → BOMBA_AGUA enciende y queda encendida
2. Presionar IN2 brevemente → BOMBA_AGUA se apaga
3. Verificar en el Monitor que el nodo SR muestra estado TRUE/FALSE correctamente

---

## EJEMPLO 2 — Semáforo peatonal con temporizador

### Situación
Un semáforo de cruce peatonal en una escuela técnica: el peatón presiona un botón, el semáforo vehicular pasa a rojo por 15 segundos, luego vuelve a verde automáticamente.

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | BOTON_PEATONAL | Pulsador en columna semáforo |
| OUT1 | LUZ_ROJA_AUTO | Señal roja para vehículos |
| OUT2 | LUZ_VERDE_PEATON | Verde para peatón |

### Lógica
```
[IN1] ──► [TP: T_CRUCE, PT=15000ms] ──► [OUT1: LUZ_ROJA_AUTO]
                    │
                    └──► [NOT] ──► [OUT2: LUZ_VERDE_PEATON]
```

**Bloques:**
- `IN1` → bloque **TP** (Timer Pulse), preset = 15000 ms
- Salida Q del **TP** → `OUT1` (luz roja)
- Salida Q del **TP** → bloque **NOT** → `OUT2` (verde peatón)

### Concepto clave
El bloque **TP** genera exactamente un pulso de duración fija al detectar el flanco ascendente de IN. No puede ser re-disparado mientras está activo, lo que evita que múltiples presiones del botón extiendan el tiempo de cruce indefinidamente. Esto es seguridad por diseño.

---

## EJEMPLO 3 — Control de temperatura con histéresis

### Situación
Un invernadero necesita mantener temperatura entre 18°C y 25°C. Un sensor de temperatura conectado a la entrada analógica AI1 entrega un valor de 0-4095 (corresponde a 0-50°C). El sistema debe encender una estufa cuando baja de 18°C y apagarla cuando supera 25°C.

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| AI1 | SENSOR_TEMP | Sensor NTC, salida 0-5V = 0-50°C |
| OUT1 | ESTUFA_CALEF | Relé estufa eléctrica 220V |

### Lógica
```
[AI1] ──► [SCALE: 0-4095 → 0-50°C] ──► [CMP: < 18] ──┐
                                                         ├─► [SR] ──► [OUT1: ESTUFA]
[AI1] ──► [SCALE] ──► [CMP: > 25] ──► [NOT] ──────────┘
```

Más simple con dos CMP directos sobre el valor escalado:
```
[SCALE salida] ──► [CMP OP=< VAL=18] ──► S ─┐
                                              ├─► [SR] ──► [OUT1]
[SCALE salida] ──► [CMP OP=> VAL=25] ──► R ─┘
```

**Bloques:**
1. `AI1` → **SCALE** (inMin=0, inMax=4095, outMin=0, outMax=50) → temperatura en °C
2. Salida SCALE → **CMP** (op=`<`, valor=18) → señal "frío"
3. Salida SCALE → **CMP** (op=`>`, valor=25) → señal "caliente"
4. "frío" → **SR** entrada S
5. "caliente" → **SR** entrada R
6. **SR** salida Q → `OUT1` ESTUFA

### Concepto clave
La histéresis (diferencia entre umbral de encendido 18°C y apagado 25°C) evita el ciclo rápido (chattering) que destruye relés y contactores. El bloque **SR** actúa como la memoria de histéresis.

### Cálculo del umbral para CMP sin SCALE
Si no se usa SCALE: valor_ADC = temperatura_°C × 4095 / 50
- 18°C = 18 × 4095/50 = **1474**
- 25°C = 25 × 4095/50 = **2048**

---

## EJEMPLO 4 — Contador de piezas en línea de producción

### Situación
Una pequeña línea de producción en taller mecánico cuenta piezas que pasan por un sensor óptico. Al llegar a 100 piezas, suena una alarma y la línea se detiene para cambiar de caja.

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | SENSOR_PIEZA | Sensor óptico (pulsa cada pieza) |
| IN2 | RESET_CONTADOR | Pulsador reset manual |
| OUT1 | ALARMA_LOTE | Alarma visual/sonora |
| OUT2 | MOTOR_CINTA | Motor cinta transportadora |

### Lógica
```
[IN1: SENSOR_PIEZA] ──► [R_TRIG] ──► CU ─┐
                                            ├─► [CTU: PV=100] ──► Q ──► [OUT1: ALARMA]
[IN2: RESET_CONTADOR] ──────────────► R ──┘         │
                                                      └── Q ──► [NOT] ──► [OUT2: MOTOR]
```

**Bloques:**
1. `IN1` → **R_TRIG** (detecta un flanco por pieza, aunque el sensor tarde en apagarse)
2. **R_TRIG** salida → **CTU** entrada CU
3. `IN2` → **CTU** entrada R (reset)
4. **CTU** preset = 100 (PV)
5. **CTU** salida Q → `OUT1` (ALARMA)
6. **CTU** salida Q → **NOT** → `OUT2` (MOTOR — se detiene cuando Q=1)

### Concepto clave
El bloque **R_TRIG** convierte una señal que puede durar varios ciclos de scan en un pulso de exactamente 1 ciclo (detección de flanco ascendente de la norma IEC). Los bloques **CTU** y **CTD** ya cuentan solo en el flanco ascendente de su entrada CU/CD, así que R_TRIG antes de un contador no es necesario para contar bien; es útil cuando se quiere ese pulso de 1 ciclo para otra cosa (SET de un biestable, disparo de un TP, etc.).

---

## EJEMPLO 5 — Temporizador de retardo al arranque (DOL con estrella-triángulo simplificado)

### Situación
Un motor de 3 fases debe arrancar en estrella durante 8 segundos y luego conmutar a triángulo. Esto reduce la corriente de arranque (muy común en talleres y agroindustria).

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | MARCHA | Pulsador marcha |
| IN2 | PARO | Pulsador paro |
| OUT1 | CONTACTOR_PRINCIPAL | K1 — alimentación principal |
| OUT2 | CONTACTOR_ESTRELLA | K2 — conexión estrella |
| OUT3 | CONTACTOR_TRIANGULO | K3 — conexión triángulo |

### Lógica
```
[IN1]──[SR: MARCHA/PARO]──► [OUT1: K_PRINCIPAL]
              │
              ├──► [TON: 8000ms] ──► Q ──► [OUT3: K_TRIANGULO]
              │
              └──► [TON Q] ──► [NOT] ──► [OUT2: K_ESTRELLA]
```

**Bloques:**
1. `IN1` → S, `IN2` → R del **SR** → salida "MOTOR_ON"
2. MOTOR_ON → `OUT1` (K_PRINCIPAL)
3. MOTOR_ON → **TON** preset=8000ms
4. **TON** Q (sale después de 8s) → `OUT3` (K_TRIANGULO)
5. **TON** Q → **NOT** → `OUT2` (K_ESTRELLA — activo los primeros 8s, se apaga al conmutar)

### Importante
En una instalación real, K2 y K3 deben tener enclavamiento eléctrico (no solo lógico) para que nunca conduzcan simultáneamente. El PLC maneja la lógica; el enclavamiento físico es una medida de seguridad adicional obligatoria.

---

## EJEMPLO 6 — Sistema de nivel con alarma y bomba

### Situación
Un tanque industrial tiene 3 sensores de nivel (bajo, medio, alto). Una bomba de llenado debe:
- Arrancar cuando el nivel es BAJO
- Detenerse cuando el nivel es ALTO
- Activar alarma si pasan 5 minutos con nivel BAJO (posible falla de bomba o rotura de tubería)

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | NIVEL_BAJO | Sensor flotante nivel mínimo |
| IN2 | NIVEL_ALTO | Sensor flotante nivel máximo |
| OUT1 | BOMBA_LLENADO | Bomba centrífuga |
| OUT2 | ALARMA_NIVEL | Alarma sonora + luz roja |

### Lógica
```
[IN1: NIVEL_BAJO] ──────────────────────────────────► S ─┐
                                                           ├─► [RS: BOMBA] ──► [OUT1]
[IN2: NIVEL_ALTO] ──────────────────────────────────► R ─┘

[IN1: NIVEL_BAJO] ──► [NOT] ──► [AND] ──► [TON: 300000ms=5min] ──► [OUT2: ALARMA]
[OUT1: BOMBA_LLENADO] ────────────────┘
```

La alarma solo activa si la bomba está ON y sigue habiendo nivel bajo después de 5 minutos.

**Concepto clave:** El bloque **RS** (Reset dominante) garantiza que si el sensor de alto falla y queda en 1, tiene prioridad sobre el de nivel bajo. El sistema falla en modo seguro (bomba apagada) en vez de riesgo de desborde.

---

## EJEMPLO 7 — Señalización intermitente (indicador de falla)

### Situación
Un panel de control debe mostrar una luz parpadeando a 1Hz cuando hay una alarma activa, y luz fija cuando el sistema está normal.

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | SEÑAL_ALARMA | Señal de alarma del proceso |
| OUT1 | PILOTO_ESTADO | Luz piloto panel |

### Lógica
```
[IN1: SEÑAL_ALARMA] ──► [AND] ──► [OUT1: PILOTO]
[BLINK: 500ms] ────────┘

[IN1: SEÑAL_ALARMA] ──► [NOT] ──► [AND] ──► [OUT1: PILOTO]  (solo uno activo)
```

Más elegante usando SEL (futuro) o simplificado:
```
Cuando IN1=0: [NOT IN1] ──► [OUT1]  (luz fija)
Cuando IN1=1: [IN1] + [BLINK 500ms] ──► [AND] ──► [OUT1]  (parpadeo)
Combinar con OR:
[NOT IN1] ──► OR ──► [OUT1]
[IN1][BLINK] ──► AND ──┘
```

**Concepto clave:** El bloque **BLINK** genera una onda cuadrada autónoma. Su entrada EN permite habilitarlo/deshabilitarlo sin perder el timing. La lógica AND + OR produce la señalización diferenciada.

---

## EJEMPLO 8 — Control de acceso con retardo (puerta automática)

### Situación
Una puerta de acceso a un estacionamiento en una oficina debe: abrirse al detectar un vehículo (sensor inductivo), mantenerse abierta 10 segundos, y luego cerrarse automáticamente.

### Tags
| Canal | Tag | Comentario |
|-------|-----|-----------|
| IN1 | SENSOR_VEHICULO | Sensor inductivo piso |
| OUT1 | MOTOR_APERTURA | Motor apertura barrera |
| OUT2 | LUZ_PASO | Luz verde paso permitido |

### Lógica
```
[IN1] ──► [TOF: 10000ms] ──► [OUT1: MOTOR_APERTURA]
                │
                └──► [OUT2: LUZ_PASO]
```

**Concepto clave:** El bloque **TOF** (Timer OFF-Delay) es ideal para este caso: la salida se activa instantáneamente cuando llega el vehículo, y se desactiva 10 segundos después de que el vehículo ya no es detectado. Esto garantiza que la puerta no cierre mientras el vehículo aún está pasando.

---

## Tabla de referencia rápida — Bloques disponibles

| Bloque | Tipo | Entradas | Salida | Uso típico |
|--------|------|----------|--------|-----------|
| AND | Lógica | 2 BOOL | BOOL | Dos condiciones simultáneas |
| OR | Lógica | 2 BOOL | BOOL | Cualquiera de dos condiciones |
| NOT | Lógica | 1 BOOL | BOOL | Negar señal, contacto NC |
| XOR | Lógica | 2 BOOL | BOOL | Diferencia exclusiva |
| CMP | Lógica | 1 INT + umbral | BOOL | Comparar valor analógico |
| TON | Timer | EN BOOL + PT | Q BOOL | Retardo al encendido |
| TOF | Timer | EN BOOL + PT | Q BOOL | Retardo al apagado |
| TP | Timer | EN BOOL + PT | Q BOOL | Pulso de duración fija |
| BLINK | Timer | EN BOOL + T | Q BOOL | Oscilador periódico |
| CTU | Contador | CU + R + PV | Q BOOL | Contar eventos ascendentes |
| CTD | Contador | CD + LD + PV | Q BOOL | Contar regresivo |
| SR | Memoria | S + R | Q BOOL | Latch, automantenimiento |
| RS | Memoria | S + R | Q BOOL | Latch reset dominante |
| R_TRIG | Flanco | IN BOOL | Q BOOL | Detectar flanco ascendente |
| F_TRIG | Flanco | IN BOOL | Q BOOL | Detectar flanco descendente |
| SCALE | Analógico | IN INT | OUT INT | Escalar ADC a unidades físicas |
| PWM | Analógico | IN 0-4095 | Pin físico | Control velocidad, intensidad |

---

## Guía de resolución de problemas

**El programa se guarda pero el PLC no responde:**
Verificar que el estado sea RUN (botón verde en la barra superior). El PLC arranca en RUN automáticamente al encender.

**Un temporizador se activa instantáneamente:**
El valor de tiempo (PT) no se está guardando correctamente. Verificar que el campo de tiempo tenga un valor numérico (ej: 5000 para 5 segundos). Guardar y hacer RELOAD.

**La salida OUT no responde aunque la lógica es correcta:**
Ir al Monitor y verificar que el nodo output muestra el estado esperado. Si el nodo está correcto pero el hardware no responde, verificar el cableado y que el PLC no esté en STOP.

**El contador no cuenta o cuenta de más:**
El contador incrementa una vez por cada flanco ascendente en CU (no cuenta mientras la señal se mantiene en 1). Verificar que CU esté en el puerto de entrada superior y R (reset) en el inferior, que la señal cambie realmente de 0 a 1 y que el reset (R) no se mantenga en 1: mientras R=1 el contador queda en 0. Un pulsador mecánico con rebotes puede generar varios flancos por pulsación; filtrarlo con un TON si hace falta.

**PWM no genera señal:**
Verificar que la salida PWM no esté conectada también como salida digital (OUT1..4). Un pin no puede funcionar en modo digital y PWM simultáneamente.

---

## Conceptos fundamentales del scan PLC

El PLC ejecuta un ciclo continuo de 10ms (100 Hz):

```
1. Leer entradas físicas (IN1, IN2, AI1) — una lectura instantánea por ciclo
2. Evaluar cada bloque UNA vez, en orden de dependencias:
   un bloque se calcula después de los bloques que lo alimentan,
   sea cual sea su tipo (AND, OR, NOT, XOR, CMP, TON, TOF, TP, BLINK,
   CTU, CTD, SR, RS, R_TRIG, F_TRIG, SCALE, PWM)
3. Escribir PWM y salidas digitales (OUT1..4)
→ volver a 1
```

**Orden de ejecución.** El orden se calcula una sola vez al cargar el programa y no depende del orden en que dibujaste los bloques ni de sus números de ID. Cuando el programa tiene un lazo (una salida que vuelve a una entrada, como en un enclavamiento), en cada lazo **un** bloque entrega al resto su valor del ciclo anterior: el bloque con memoria de menor ID (SR, RS, TON, CTU...) o, si no hay ninguno, el bloque de menor ID. Esto hace que el resultado sea siempre el mismo en el PLC y en el simulador. Para que los enclavamientos sean fáciles de razonar, cerrá el lazo a través de un SR/RS.

**Puertos de entrada.** Lo que importa es el puerto al que llega el cable, no el orden en que los dibujaste: puerto superior = S (SR/RS), CU (CTU), CD (CTD), A de las compuertas; puerto inferior = R, LD, B.

**SCALE.** Usa aritmética entera con truncamiento hacia cero: `(valor − inMin) × (outMax − outMin) / (inMax − inMin) + outMin`, limitado al rango [outMin, outMax]. Si inMax = inMin, la salida es outMin. Un 0 escrito explícitamente en un parámetro vale 0; solo un campo vacío usa el valor por defecto (0, 4095, 0, 100).

**Importante:** Todas las entradas se leen al inicio del ciclo y todas las salidas se escriben al final. Esto significa que los cambios en las entradas no se ven hasta el próximo ciclo. A 10ms de ciclo, la latencia máxima es de 10ms — completamente aceptable para todas las aplicaciones industriales de control de movimiento lento y proceso.

---

*PLC-CORE-MDE v5 — Proyecto educativo / industrial de bajo costo*
*Compatible con IEC 61131-3 (FBD parcial) — RS485/Modbus RTU*
