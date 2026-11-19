/*
 PLC-CORE-MDE Project
 Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
 Argentina

 Licensed under PLC-CORE-MDE License v1.0
 See LICENSE file for details
*/
#ifndef PLC_RUNTIME_H
#define PLC_RUNTIME_H

#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define MAX_NODES 64
#define MAX_LINKS 8

// ============================================================
// Tipos de nodo (se resuelven UNA vez en parseProgram, no en el scan)
// ============================================================
enum NodeType
{
    NT_UNKNOWN = 0,
    NT_INPUT,    // input1, input2
    NT_ANALOG,   // analog1
    NT_OUTPUT,   // output1..output4
    NT_AND, NT_OR, NT_NOT, NT_XOR, NT_CMP,
    NT_TON, NT_TOF, NT_TP, NT_BLINK,
    NT_CTU, NT_CTD,
    NT_SR, NT_RS,
    NT_RTRIG, NT_FTRIG,
    NT_SCALE, NT_PWM,
    NT_PREV      // SR(S=X, R=NOT X) generado por compiladores antiguos:
                 // registro de 1 scan (Q = X del scan anterior)
};

// ============================================================
// PlcNode — nodo del runtime IEC 61131-3
// ============================================================
struct PlcNode
{
    int    id;        // ID drawflow (arbitrario)
    String name;      // tipo de nodo: "input1","ton","and", etc.
    int    type;      // NodeType (derivado de name en parseProgram)
    int    phys;      // índice físico de entrada/salida/analógica (-1 si no aplica)

    // --- Valores de señal ---
    bool   state;     // salida booleana (BOOL)
    int    intValue;  // valor entero    (INT / ADC crudo 0-4095)
    float  realValue; // valor real      (REAL — futuro escala física)

    // --- Conexiones resueltas en parseProgram(), nunca en scan ---
    int input1;                 // índice en nodes[] del primer driver
    int input2;                 // índice en nodes[] del segundo driver
    int outputs[MAX_LINKS];     // IDs drawflow de destinos
    int outputCount;

    // --- Parámetros desde el editor ---
    int    value;     // umbral CMP / valor PWM fijo / preset contador
    String op;        // operador: >, <, >=, <=, ==, !=
    int    outIdx;    // índice salida física (0-3) para nodos output/PWM
    // NOTA: renombrado de 'out' a 'outIdx' para evitar colisión con
    // la macro out() de algunos compiladores AVR/ESP32

    // --- Preset de tiempo (RENOMBRADO de 'time' a 'preset') ---
    // 'time' es nombre reservado en newlib/POSIX → causa bugs silenciosos
    unsigned long preset;  // tiempo en ms para TON/TOF/TP

    // --- Timers ---
    unsigned long timerElapsed;
    unsigned long timerStart;
    bool timerRunning;
    bool timerDone;
    bool timerPrevIn;

    // --- Contadores CTU/CTD ---
    int  counterVal;       // valor actual del contador
    bool counterCU;        // entrada CU
    bool counterCD;        // entrada CD
    bool counterR;         // reset
    bool counterLD;        // load (CTD)
    bool counterPrevCU;
    bool counterPrevCD;

    // --- Memorias SR/RS ---
    bool memState;

    // --- Flancos R_TRIG / F_TRIG ---
    bool trigPrevIn;
    bool trigQ;

    // --- SCALE: escalado lineal ---
    int scaleInMin;
    int scaleInMax;
    int scaleOutMin;
    int scaleOutMax;

    // --- BLINK: oscilador ---
    bool         blinkState;
    unsigned long blinkLast;
};

// ============================================================
// Mutex FreeRTOS — protege nodes[] entre Core0 (web) y Core1 (scan)
// ============================================================
extern SemaphoreHandle_t plcMutex;

extern PlcNode nodes[MAX_NODES];
extern int nodeCount;

// Orden de ejecución determinista calculado en parseProgram()
// (ver plc_runtime.cpp: plcBuildExecOrder)
extern int execOrder[MAX_NODES];
extern int execCount;

void parseProgram(String json);
void plcScan();
void runtimeClear();

#endif
