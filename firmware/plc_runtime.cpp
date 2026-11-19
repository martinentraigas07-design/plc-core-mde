/*
 PLC-CORE-MDE Project
 Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
 Argentina

 Licensed under PLC-CORE-MDE License v1.0
 See LICENSE file for details
*/
// =============================================================
// plc_runtime.cpp — PLC-CORE-MDE v6 (motor de ejecución determinista)
//
// Nodos: AND OR NOT XOR CMP | TON TOF TP BLINK | CTU CTD |
//        SR RS | R_TRIG F_TRIG | SCALE | PWM | input1/2 analog1 output1-4
//
// MODELO DE EJECUCIÓN (v6)
//   Un scan = 1) leer entradas físicas (instantánea)
//             2) evaluar cada nodo UNA vez, en orden de dependencias
//             3) actualizar los registros de 1 scan (NT_PREV)
//             4) escribir salidas / PWM
//
//   El orden se calcula una sola vez en parseProgram() (plcBuildExecOrder):
//     * Un nodo se evalúa después de los nodos que lo alimentan, de modo
//       que ve valores del MISMO scan (sin retardos ni pulsos espurios).
//     * Realimentaciones: en cada lazo se "registra" la salida de UN nodo
//       (el bloque con memoria de menor ID; si no hay, el nodo de menor ID).
//       Sus consumidores dentro del lazo leen el valor del scan anterior.
//       Así el resultado es determinista y los enclavamientos entre
//       biestables funcionan (el segundo biestable ve al primero ya
//       actualizado en el mismo scan).
//     * Desempate: a igualdad de dependencias se evalúa el de menor ID.
//
//   Puertos: cada conexión de Drawflow indica a qué puerto de entrada llega
//   ("input_1" / "input_2"). input1 = puerto 1 (S, CU, CD, A, IN...),
//   input2 = puerto 2 (R, LD, B...). Ya NO depende del orden de los IDs.
//
//   Valores numéricos: AI1 y SCALE propagan su valor entero (intValue);
//   CMP y PWM lo leen. El resto de las señales son booleanas.
//   SCALE usa aritmética entera con truncamiento hacia cero (referencia).
// =============================================================

#include "plc_runtime.h"
#include "plc_io.h"
#include "plc_state.h"
#include <ArduinoJson.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

PlcNode nodes[MAX_NODES];
int nodeCount = 0;
int execOrder[MAX_NODES];
int execCount = 0;
SemaphoreHandle_t plcMutex = NULL;

// -------------------------------------------------------------
// Capacidades del documento JSON (ver informe, sección persistencia).
// Se intenta de menor a mayor; el documento solo conserva
// {id, name, data, outputs.*.connections} de cada nodo (filtro).
// -------------------------------------------------------------
#ifndef PLC_JSON_CAP_1
#define PLC_JSON_CAP_1 12288
#endif
#ifndef PLC_JSON_CAP_2
#define PLC_JSON_CAP_2 24576
#endif
#ifndef PLC_JSON_CAP_3
#define PLC_JSON_CAP_3 49152
#endif

// -------------------------------------------------------------
// Helpers internos
// -------------------------------------------------------------

static int getNodeIndexById(int id)
{
    for (int i = 0; i < nodeCount; i++)
        if (nodes[i].id == id) return i;
    return -1;
}

static bool isNumericSource(int type)
{
    return type == NT_ANALOG || type == NT_SCALE;
}

// Valor numérico efectivo de un nodo (para CMP): AI1 y SCALE -> intValue,
// el resto -> 0/1 según su estado booleano.
static int getNodeIntValue(int idx)
{
    if (idx < 0) return 0;
    if (isNumericSource(nodes[idx].type)) return nodes[idx].intValue;
    return nodes[idx].state ? 1 : 0;
}

static bool inState(const PlcNode& n, int which)
{
    int src = (which == 0) ? n.input1 : n.input2;
    return (src >= 0) ? nodes[src].state : false;
}

static int nodeTypeFromName(const String& name, int* phys)
{
    *phys = -1;
    if (name == "input1")  { *phys = 0; return NT_INPUT; }
    if (name == "input2")  { *phys = 1; return NT_INPUT; }
    if (name == "analog1") { *phys = 0; return NT_ANALOG; }
    if (name == "output1") { *phys = 0; return NT_OUTPUT; }
    if (name == "output2") { *phys = 1; return NT_OUTPUT; }
    if (name == "output3") { *phys = 2; return NT_OUTPUT; }
    if (name == "output4") { *phys = 3; return NT_OUTPUT; }
    if (name == "and")     return NT_AND;
    if (name == "or")      return NT_OR;
    if (name == "not")     return NT_NOT;
    if (name == "xor")     return NT_XOR;
    if (name == "cmp")     return NT_CMP;
    if (name == "ton")     return NT_TON;
    if (name == "tof")     return NT_TOF;
    if (name == "tp")      return NT_TP;
    if (name == "blink")   return NT_BLINK;
    if (name == "ctu")     return NT_CTU;
    if (name == "ctd")     return NT_CTD;
    if (name == "sr")      return NT_SR;
    if (name == "rs")      return NT_RS;
    if (name == "r_trig")  return NT_RTRIG;
    if (name == "f_trig")  return NT_FTRIG;
    if (name == "scale")   return NT_SCALE;
    if (name == "pwm")     return NT_PWM;
    return NT_UNKNOWN;
}

static bool isMemoryType(int t)
{
    return t == NT_TON || t == NT_TOF || t == NT_TP || t == NT_BLINK ||
           t == NT_CTU || t == NT_CTD || t == NT_SR || t == NT_RS ||
           t == NT_RTRIG || t == NT_FTRIG;
}

// Convierte un valor JSON (número o string, como los guarda Drawflow) a int.
static int jsonToInt(JsonVariantConst v)
{
    if (v.isNull()) return 0;
    if (v.is<int>()) return v.as<int>();
    const char* s = v.as<const char*>();
    return String(s ? s : "0").toInt();
}

// -------------------------------------------------------------
// runtimeClear
// -------------------------------------------------------------
void runtimeClear()
{
    nodeCount = 0;
    execCount = 0;
    // plcMutex se crea una sola vez en setup(), no aquí
}

// -------------------------------------------------------------
// plcBuildExecOrder — orden de ejecución determinista
//
// Mismo algoritmo en simulator/plc_sim_runtime.js (buildExecOrder):
//   1. Aristas driver -> consumidor para input1/input2.
//      Los nodos NT_PREV (registro de 1 scan) no generan aristas.
//   2. Mientras exista un ciclo (componente fuertemente conexa de más de
//      un nodo, o autolazo): pivote = bloque con memoria de menor ID de la
//      componente (si no hay: nodo de menor ID). Se cortan las aristas
//      pivote -> consumidor dentro de la componente: esos consumidores
//      leen el valor del scan anterior del pivote, y se les impone
//      evaluarse ANTES que el pivote.
//   3. Orden topológico (Kahn) eligiendo siempre el nodo listo de menor ID.
// -------------------------------------------------------------
static int g_sccIndex[MAX_NODES];
static int g_sccLow[MAX_NODES];
static bool g_sccOn[MAX_NODES];
static int g_sccComp[MAX_NODES];
static int g_sccStack[MAX_NODES];
static int g_sccSp;
static int g_sccCounter;
static int g_sccCompCount;
static bool g_edgeCut[MAX_NODES][2];
static bool g_edgeOn[MAX_NODES][2];

static inline int predOf(int i, int k)
{
    return (k == 0) ? nodes[i].input1 : nodes[i].input2;
}

static void sccVisit(int v)
{
    g_sccIndex[v] = g_sccLow[v] = ++g_sccCounter;
    g_sccStack[g_sccSp++] = v;
    g_sccOn[v] = true;

    // sucesores de v: nodos w que tienen a v como driver (arista activa)
    for (int w = 0; w < nodeCount; w++)
    {
        for (int k = 0; k < 2; k++)
        {
            if (!g_edgeOn[w][k] || g_edgeCut[w][k]) continue;
            if (predOf(w, k) != v) continue;
            if (g_sccIndex[w] == 0)
            {
                sccVisit(w);
                if (g_sccLow[w] < g_sccLow[v]) g_sccLow[v] = g_sccLow[w];
            }
            else if (g_sccOn[w])
            {
                if (g_sccIndex[w] < g_sccLow[v]) g_sccLow[v] = g_sccIndex[w];
            }
        }
    }

    if (g_sccLow[v] == g_sccIndex[v])
    {
        int w;
        do {
            w = g_sccStack[--g_sccSp];
            g_sccOn[w] = false;
            g_sccComp[w] = g_sccCompCount;
        } while (w != v);
        g_sccCompCount++;
    }
}

static void plcBuildExecOrder()
{
    const int n = nodeCount;
    execCount = 0;
    if (n <= 0) return;

    // Índices ordenados por ID ascendente
    int byId[MAX_NODES];
    for (int i = 0; i < n; i++) byId[i] = i;
    for (int a = 1; a < n; a++)
    {
        int key = byId[a], b = a - 1;
        while (b >= 0 && nodes[byId[b]].id > nodes[key].id) { byId[b + 1] = byId[b]; b--; }
        byId[b + 1] = key;
    }

    // Aristas activas
    for (int i = 0; i < n; i++)
        for (int k = 0; k < 2; k++)
        {
            int p = predOf(i, k);
            g_edgeCut[i][k] = false;
            g_edgeOn[i][k]  = (p >= 0 && p != i && nodes[p].type != NT_PREV);
            // autolazo: lee su propio valor anterior (sin restricción de orden)
        }

    // Restricciones extra "x debe evaluarse antes que pivote"
    uint64_t before[MAX_NODES];
    for (int i = 0; i < n; i++) before[i] = 0;

    for (int guard = 0; guard < n * 2 + 2; guard++)
    {
        for (int i = 0; i < n; i++) { g_sccIndex[i] = 0; g_sccLow[i] = 0; g_sccOn[i] = false; g_sccComp[i] = -1; }
        g_sccSp = 0; g_sccCounter = 0; g_sccCompCount = 0;
        for (int i = 0; i < n; i++)
            if (g_sccIndex[i] == 0) sccVisit(i);

        bool cutAny = false;
        for (int c = 0; c < g_sccCompCount; c++)
        {
            int size = 0;
            for (int i = 0; i < n; i++) if (g_sccComp[i] == c) size++;
            if (size < 2) continue;                       // sin autolazos: g_edgeOn los excluye

            // pivote: bloque con memoria de menor ID; si no hay, menor ID
            int pivot = -1, pivotAny = -1;
            for (int a = 0; a < n; a++)
            {
                int i = byId[a];
                if (g_sccComp[i] != c) continue;
                if (pivotAny < 0) pivotAny = i;
                if (pivot < 0 && isMemoryType(nodes[i].type)) pivot = i;
            }
            if (pivot < 0) pivot = pivotAny;

            for (int x = 0; x < n; x++)
            {
                if (g_sccComp[x] != c) continue;
                for (int k = 0; k < 2; k++)
                {
                    if (!g_edgeOn[x][k] || g_edgeCut[x][k]) continue;
                    if (predOf(x, k) != pivot) continue;
                    g_edgeCut[x][k] = true;
                    before[pivot] |= ((uint64_t)1 << x);
                    cutAny = true;
                }
            }
        }
        if (!cutAny) break;
    }

    // Kahn con desempate por menor ID. Dos intentos: con y sin restricciones extra.
    for (int attempt = 0; attempt < 2; attempt++)
    {
        uint64_t done = 0;
        execCount = 0;
        bool stuck = false;
        while (execCount < n)
        {
            int pick = -1;
            for (int a = 0; a < n; a++)
            {
                int i = byId[a];
                if (done & ((uint64_t)1 << i)) continue;
                uint64_t need = (attempt == 0) ? before[i] : 0;
                for (int k = 0; k < 2; k++)
                    if (g_edgeOn[i][k] && !g_edgeCut[i][k])
                        need |= ((uint64_t)1 << predOf(i, k));
                if ((need & ~done) == 0) { pick = i; break; }
            }
            if (pick < 0) { stuck = true; break; }
            execOrder[execCount++] = pick;
            done |= ((uint64_t)1 << pick);
        }
        if (!stuck) return;
        if (attempt == 1)
        {
            // No debería ocurrir; se completa por ID para no perder nodos.
            Serial.println("[PLC] AVISO: orden de ejecución incompleto, se completa por ID");
            for (int a = 0; a < n; a++)
            {
                int i = byId[a];
                if (!(done & ((uint64_t)1 << i))) { execOrder[execCount++] = i; done |= ((uint64_t)1 << i); }
            }
        }
    }
}

// Si parseProgram() rechaza un JSON y conserva el programa anterior, los
// canales PWM (que plcReload() liberó antes de re-parsear) deben volver a
// registrarse para que ese programa siga funcionando.
static void restorePwmRegistrations()
{
    for (int i = 0; i < nodeCount; i++)
        if (nodes[i].type == NT_PWM)
        {
            plcRegisterPWM(nodes[i].outIdx);
            plcMarkPinAsPWM(nodes[i].outIdx);
        }
}

// -------------------------------------------------------------
// parseProgram
//   0) deserializar con filtro (solo lo que usa el runtime) SIN tocar
//      el programa en ejecución: si el JSON es inválido se conserva
//      el programa anterior
//   1) cargar nodos
//   2) resolver input1/input2 por PUERTO de entrada
//   3) tipos especiales, orden de ejecución
//   4) registrar pines PWM con LEDC
// -------------------------------------------------------------
void parseProgram(String json)
{
    if (plcMutex == NULL)
        plcMutex = xSemaphoreCreateMutex();

    if (json.length() == 0)
    {
        xSemaphoreTake(plcMutex, portMAX_DELAY);
        nodeCount = 0;
        execCount = 0;
        xSemaphoreGive(plcMutex);
        Serial.println("[PLC] parseProgram: JSON vacío");
        return;
    }

    // Filtro: conserva solo id, name, data y connections de cada nodo.
    // Descarta html, inputs, class, pos_x/pos_y, "fbd", "ir", "symbolTable"...
    StaticJsonDocument<384> filter;
    JsonObject fNode = filter["drawflow"]["Home"]["data"].createNestedObject("*");
    fNode["id"]   = true;
    fNode["name"] = true;
    fNode["data"] = true;
    fNode["outputs"]["*"]["connections"] = true;

    static const size_t caps[3] = { PLC_JSON_CAP_1, PLC_JSON_CAP_2, PLC_JSON_CAP_3 };
    DynamicJsonDocument* docp = NULL;
    DeserializationError err = DeserializationError::NoMemory;
    size_t usedCap = 0;

    for (int c = 0; c < 3; c++)
    {
        delete docp;
        docp = new DynamicJsonDocument(caps[c]);
        if (docp->capacity() == 0) { err = DeserializationError::NoMemory; continue; }
        err = deserializeJson(*docp, json, DeserializationOption::Filter(filter));
        usedCap = caps[c];
        if (err != DeserializationError::NoMemory) break;
    }

    if (err)
    {
        Serial.printf("[PLC] JSON error: %s (programa anterior conservado)\n", err.c_str());
        delete docp;
        restorePwmRegistrations();
        return;
    }
    DynamicJsonDocument& doc = *docp;
    Serial.printf("[PLC] JSON OK: %u bytes de documento usados (cap=%u)\n",
                  (unsigned)doc.memoryUsage(), (unsigned)usedCap);

    JsonObject data = doc["drawflow"]["Home"]["data"];
    if (data.isNull())
    {
        Serial.println("[PLC] parseProgram: no se encontró drawflow.Home.data (programa anterior conservado)");
        delete docp;
        restorePwmRegistrations();
        return;
    }

    xSemaphoreTake(plcMutex, portMAX_DELAY);

    nodeCount = 0;
    execCount = 0;
    JsonObject jsonNodes[MAX_NODES];

    // ---- PASADA 1: cargar nodos ----
    for (JsonPair kv : data)
    {
        if (nodeCount >= MAX_NODES)
        {
            Serial.printf("[PLC] AVISO: el programa tiene más de %d nodos; se ignoran los restantes\n", MAX_NODES);
            break;
        }

        JsonObject node = kv.value();
        PlcNode& n = nodes[nodeCount];
        jsonNodes[nodeCount] = node;

        n.id   = node["id"].as<int>();
        n.name = node["name"].as<String>();
        n.type = nodeTypeFromName(n.name, &n.phys);

        // Señales
        n.state     = false;
        n.intValue  = 0;
        n.realValue = 0.0f;

        // Conexiones (se resuelven en pasada 2)
        n.input1      = -1;
        n.input2      = -1;
        n.outputCount = 0;

        // Drawflow guarda los valores de <input>/<select> como strings.
        auto readInt = [&](const char* key) -> int {
            return jsonToInt(node["data"][key]);
        };
        // Parámetro con valor por defecto SOLO si falta o está vacío
        // (un 0 explícito es un valor válido, p.ej. outMax=0 en escala inversa).
        auto readIntDef = [&](const char* key, int def) -> int {
            JsonVariantConst v = node["data"][key];
            if (v.isNull()) return def;
            const char* s = v.is<const char*>() ? v.as<const char*>() : NULL;
            if (s && s[0] == '\0') return def;
            return jsonToInt(v);
        };
        auto readULong = [&](const char* key) -> unsigned long {
            JsonVariantConst v = node["data"][key];
            if (v.isNull()) return 0UL;
            if (v.is<long>()) { long l = v.as<long>(); return (l < 0) ? 0UL : (unsigned long)l; }
            long l = String(v.as<const char*>() ? v.as<const char*>() : "0").toInt();
            return (l < 0) ? 0UL : (unsigned long)l;
        };

        n.value  = readInt("value");
        n.outIdx = readInt("out");
        n.preset = readULong("time");

        // op es siempre string
        n.op = node["data"]["op"] | ">";

        // Estado timers — reset limpio
        n.timerStart   = 0;
        n.timerElapsed = 0;
        n.timerRunning = false;
        n.timerDone    = false;
        n.timerPrevIn  = false;

        // Contadores, memorias, flancos, escala
        n.counterVal    = readInt("pv");
        n.counterCU     = false; n.counterCD = false;
        n.counterR      = false; n.counterLD = false;
        n.counterPrevCU = false; n.counterPrevCD = false;
        n.memState      = false;
        n.trigPrevIn    = false; n.trigQ = false;
        n.scaleInMin    = readIntDef("inMin", 0);
        n.scaleInMax    = readIntDef("inMax", 4095);
        n.scaleOutMin   = readIntDef("outMin", 0);
        n.scaleOutMax   = readIntDef("outMax", 100);
        n.blinkState    = false; n.blinkLast = 0;

        nodeCount++;
    }

    // ---- PASADA 2: resolver conexiones por PUERTO ----
    // Los drivers se recorren en orden de ID ascendente, de modo que el
    // reparto de respaldo (conexión sin puerto válido) es determinista.
    {
        int byId[MAX_NODES];
        for (int i = 0; i < nodeCount; i++) byId[i] = i;
        for (int a = 1; a < nodeCount; a++)
        {
            int key = byId[a], b = a - 1;
            while (b >= 0 && nodes[byId[b]].id > nodes[key].id) { byId[b + 1] = byId[b]; b--; }
            byId[b + 1] = key;
        }

        for (int a = 0; a < nodeCount; a++)
        {
            int j = byId[a];
            JsonObject outs = jsonNodes[j]["outputs"];
            for (JsonPair outPort : outs)
            {
                JsonArray conns = outPort.value()["connections"];
                for (JsonObject c : conns)
                {
                    int targetId = jsonToInt(c["node"]);
                    int t = getNodeIndexById(targetId);
                    if (t < 0) continue;

                    // informativo (monitor): destinos del driver
                    if (nodes[j].outputCount < MAX_LINKS)
                        nodes[j].outputs[nodes[j].outputCount++] = targetId;

                    int port = -1;
                    const char* pn = c["output"] | "";
                    if (strncmp(pn, "input_", 6) == 0) port = atoi(pn + 6) - 1;

                    int* s1 = &nodes[t].input1;
                    int* s2 = &nodes[t].input2;
                    if      (port == 0 && *s1 < 0) *s1 = j;
                    else if (port == 1 && *s2 < 0) *s2 = j;
                    else
                    {
                        // Cable sin puerto válido, o segundo cable al MISMO puerto:
                        // se usa el puerto libre (igual que el firmware anterior) o,
                        // si no hay, se descarta. En ambos casos se avisa por Serial.
                        if      (*s1 < 0) { *s1 = j; }
                        else if (*s2 < 0) { *s2 = j; }
                        if (port == 0 || port == 1)
                            Serial.printf("[PLC] AVISO: nodo %d, puerto %d con mas de un cable (nodo %d)\n",
                                          nodes[t].id, port + 1, nodes[j].id);
                    }
                    // más de 2 drivers para un nodo: el exceso se descarta
                }
            }
        }
    }

    // ---- PASADA 3: idioma heredado SR(S=X, R=NOT X) = registro de 1 scan ----
    // Lo generaban versiones anteriores del compilador Ladder para detectar
    // flancos. Se conserva su semántica (Q = X del scan anterior).
    for (int i = 0; i < nodeCount; i++)
    {
        if (nodes[i].type != NT_SR) continue;
        int a = nodes[i].input1, b = nodes[i].input2;
        if (a < 0 || b < 0) continue;
        if (nodes[b].type == NT_NOT && nodes[b].input1 == a && nodes[b].input2 < 0)
            nodes[i].type = NT_PREV;
    }

    // ---- PASADA 4: orden de ejecución ----
    plcBuildExecOrder();

    // ---- PASADA 5: registrar PWM ----
    for (int i = 0; i < nodeCount; i++)
    {
        if (nodes[i].type == NT_PWM)
        {
            plcRegisterPWM(nodes[i].outIdx);
            plcMarkPinAsPWM(nodes[i].outIdx);
        }
    }

    xSemaphoreGive(plcMutex);
    delete docp;
    Serial.printf("[PLC] parseProgram OK: %d nodos\n", nodeCount);
}

// -------------------------------------------------------------
// plcScan — ciclo PLC (corre en Core 1 cada 10ms)
// -------------------------------------------------------------
void plcScan()
{
    if (plcMode != PLC_RUN) return;
    if (plcMutex == NULL)   return;
    if (xSemaphoreTake(plcMutex, 0) != pdTRUE) return;

    const unsigned long now = millis();

    // =========================================================
    // FASE 1: Leer entradas físicas (instantánea del scan)
    // =========================================================
    for (int i = 0; i < nodeCount; i++)
    {
        if (nodes[i].type == NT_INPUT)
            nodes[i].state = plcReadInput(nodes[i].phys);
        else if (nodes[i].type == NT_ANALOG)
        {
            nodes[i].intValue = plcReadAnalog(nodes[i].phys);
            nodes[i].state    = (nodes[i].intValue > 2048);
        }
    }

    // =========================================================
    // FASE 2: Evaluar cada nodo una vez, en orden de dependencias
    // =========================================================
    for (int e = 0; e < execCount; e++)
    {
        PlcNode& n = nodes[execOrder[e]];

        switch (n.type)
        {
        case NT_AND: n.state = inState(n, 0) && inState(n, 1); break;
        case NT_OR:  n.state = inState(n, 0) || inState(n, 1); break;
        case NT_NOT: n.state = !inState(n, 0);                 break;
        case NT_XOR: n.state = inState(n, 0) != inState(n, 1); break;

        case NT_CMP:
        {
            int val1 = getNodeIntValue(n.input1);
            int val2 = (n.input2 >= 0) ? getNodeIntValue(n.input2) : n.value;
            const String& op = n.op;
            if      (op == ">")  n.state = (val1 >  val2);
            else if (op == "<")  n.state = (val1 <  val2);
            else if (op == ">=") n.state = (val1 >= val2);
            else if (op == "<=") n.state = (val1 <= val2);
            else if (op == "==") n.state = (val1 == val2);
            else if (op == "!=") n.state = (val1 != val2);
            else                 n.state = false;
            break;
        }

        case NT_TON:
        {
            bool IN = inState(n, 0);
            if (IN) {
                if (!n.timerRunning) {
                    n.timerRunning = true;
                    n.timerDone    = false;
                    n.timerStart   = now;
                    n.state        = false;
                } else if ((now - n.timerStart) >= n.preset) {
                    n.state     = true;
                    n.timerDone = true;
                }
            } else {
                n.timerRunning = false;
                n.timerDone    = false;
                n.state        = false;
            }
            break;
        }

        case NT_TOF:
        {
            bool IN = inState(n, 0);
            bool risingEdge  = IN  && !n.timerPrevIn;
            bool fallingEdge = !IN &&  n.timerPrevIn;
            if (risingEdge) {
                n.state        = true;
                n.timerRunning = false;
                n.timerDone    = false;
            } else if (fallingEdge) {
                n.timerRunning = true;
                n.timerDone    = false;
                n.timerStart   = now;
                n.state        = true;
            } else if (!IN && n.timerRunning) {
                if ((now - n.timerStart) >= n.preset) {
                    n.state        = false;
                    n.timerRunning = false;
                    n.timerDone    = true;
                }
            } else if (!IN && n.timerDone) {
                n.state = false;
            } else if (IN) {
                n.state = true;
            }
            n.timerPrevIn = IN;
            break;
        }

        case NT_TP:
        {
            bool IN = inState(n, 0);
            bool risingEdge = IN && !n.timerPrevIn;
            if (risingEdge && !n.timerRunning) {
                n.timerRunning = true;
                n.timerDone    = false;
                n.timerStart   = now;
                n.state        = true;
            } else if (n.timerRunning) {
                if ((now - n.timerStart) >= n.preset) {
                    n.timerRunning = false;
                    n.timerDone    = true;
                    n.state        = false;
                }
            } else if (n.timerDone && !IN) {
                n.timerDone = false;
            }
            n.timerPrevIn = IN;
            break;
        }

        case NT_BLINK:
        {
            bool EN = (n.input1 >= 0) ? nodes[n.input1].state : true;
            if (!EN) {
                n.state     = false;
                n.blinkLast = now;
            } else {
                if ((now - n.blinkLast) >= n.preset) {
                    n.blinkState = !n.blinkState;
                    n.blinkLast  = now;
                }
                n.state = n.blinkState;
            }
            break;
        }

        case NT_CTU:
        {
            // CU = input1 (flanco ascendente cuenta), R = input2 (reset)
            bool CU = inState(n, 0);
            bool R  = inState(n, 1);
            if (R) {
                n.intValue = 0;
            } else if (CU && !n.counterPrevCU) {
                n.intValue++;
            }
            n.state         = (n.intValue >= n.value);
            n.counterPrevCU = CU;
            break;
        }

        case NT_CTD:
        {
            // CD = input1 (flanco ascendente descuenta), LD = input2 (carga PV)
            bool CD = inState(n, 0);
            bool LD = inState(n, 1);
            if (LD) {
                n.intValue = n.value;
            } else if (CD && !n.counterPrevCD) {
                if (n.intValue > 0) n.intValue--;
            }
            n.state         = (n.intValue <= 0);
            n.counterPrevCD = CD;
            break;
        }

        case NT_SR:
        {
            bool S = inState(n, 0), R = inState(n, 1);
            if      (S) n.state = true;     // Set dominante
            else if (R) n.state = false;
            break;
        }

        case NT_RS:
        {
            bool S = inState(n, 0), R = inState(n, 1);
            if      (R) n.state = false;    // Reset dominante
            else if (S) n.state = true;
            break;
        }

        case NT_RTRIG:
        {
            bool IN = inState(n, 0);
            n.state      = IN && !n.trigPrevIn;
            n.trigPrevIn = IN;
            break;
        }

        case NT_FTRIG:
        {
            bool IN = inState(n, 0);
            n.state      = !IN && n.trigPrevIn;
            n.trigPrevIn = IN;
            break;
        }

        case NT_SCALE:
        {
            // Aritmética entera de 64 bits, división truncada hacia cero.
            // Referencia para el simulador (mismos resultados bit a bit).
            int64_t raw    = (n.input1 >= 0) ? nodes[n.input1].intValue : 0;
            int64_t inMin  = n.scaleInMin,  inMax  = n.scaleInMax;
            int64_t outMin = n.scaleOutMin, outMax = n.scaleOutMax;
            if (inMax == inMin) {
                n.intValue = (int)outMin;          // rango de entrada nulo: sin división
            } else {
                int64_t scaled = (raw - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
                int64_t lo = (outMin < outMax) ? outMin : outMax;
                int64_t hi = (outMin < outMax) ? outMax : outMin;
                if (scaled < lo) scaled = lo;
                if (scaled > hi) scaled = hi;
                n.intValue = (int)scaled;
            }
            n.state = (n.intValue > 0);
            break;
        }

        case NT_PWM:
        {
            int value = n.value;
            if (n.input1 >= 0) {
                const PlcNode& src = nodes[n.input1];
                if (isNumericSource(src.type)) value = src.intValue;
                else                           value = src.state ? 4095 : 0;
            }
            n.intValue = value;                 // se escribe en la FASE 4
            break;
        }

        case NT_OUTPUT:
            n.state = inState(n, 0);            // se escribe en la FASE 4
            break;

        default:
            break;                              // entradas, analógica, NT_PREV, desconocidos
        }
    }

    // =========================================================
    // FASE 3: Registros de 1 scan (NT_PREV) — se actualizan al final,
    // de modo que durante el scan sus consumidores ven el valor anterior.
    // =========================================================
    for (int i = 0; i < nodeCount; i++)
        if (nodes[i].type == NT_PREV)
            nodes[i].state = inState(nodes[i], 0);

    // =========================================================
    // FASE 4: Escribir salidas físicas y PWM
    // =========================================================
    for (int i = 0; i < nodeCount; i++)
    {
        if (nodes[i].type == NT_OUTPUT)
            plcWriteOutput(nodes[i].phys, nodes[i].state);
        else if (nodes[i].type == NT_PWM)
            plcWritePWM(nodes[i].outIdx, nodes[i].intValue);
    }

    xSemaphoreGive(plcMutex);
}
