// =============================================================
// plc_control.cpp — PLC-CORE-MDE v3
// plcStop(): apaga salidas digitales, NO toca pines PWM
// plcReload(): reset PWM completo antes de reparse
// =============================================================

#include "plc_control.h"
#include "plc_state.h"
#include "plc_runtime.h"
#include "plc_io.h"
#include "storage.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void plcRun()
{
    plcMode = PLC_RUN;
}

void plcStop()
{
    plcMode = PLC_STOP;

    // Apagar salidas digitales (las PWM las maneja plcResetAllPWM)
    for (int i = 0; i < NUM_OUTPUTS; i++)
        plcWriteOutput(i, false);
}

void plcReload()
{
    // 1. Detener scan — el mutex en plcScan garantiza que no
    //    interrumpimos en mitad de un ciclo.
    plcMode = PLC_STOP;

    // 2. Esperar que el task PLC libere el mutex (máx. 1 ciclo = 10ms)
    vTaskDelay(25 / portTICK_PERIOD_MS);

    // 3. Reset PWM: detach canales LEDC, restaurar pines como GPIO
    plcResetAllPWM();

    // 4. NO se limpia la tabla de nodos aquí: parseProgram() es transaccional y
    //    solo reemplaza el programa cuando el JSON nuevo se leyó completo. Si el
    //    JSON es inválido o no entra en memoria, el programa anterior sigue
    //    cargado (y parseProgram vuelve a registrar sus canales PWM).

    // 5. Reparse (incluye pasada de registro PWM con LEDC fresco)
    String json = loadProgram();
    parseProgram(json);

    // 6. Reanudar
    plcMode = PLC_RUN;
}
