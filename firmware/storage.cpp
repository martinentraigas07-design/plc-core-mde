#include <Arduino.h>
#include "storage.h"
#include <SPIFFS.h>

String loadProgram()
{
    // Recuperación: si se cortó la energía justo entre borrar /program.json y
    // renombrar /program.tmp (ver handleSave), el programa completo está en .tmp
    if (!SPIFFS.exists("/program.json") && SPIFFS.exists("/program.tmp"))
    {
        Serial.println("Recovering program from /program.tmp");
        SPIFFS.rename("/program.tmp", "/program.json");
    }

    File f = SPIFFS.open("/program.json", "r");

    if (!f)
    {
        Serial.println("No program");
        return "";
    }

    String data = f.readString();

    f.close();

    // Solo el tamaño: volcar el JSON completo por Serial a 115200 baud tarda
    // ~0,1 ms por byte (77 KB = casi 7 s) y el PLC está detenido durante plcReload().
    Serial.printf("Program loaded: %u bytes\n", (unsigned)data.length());

    return data;
}
