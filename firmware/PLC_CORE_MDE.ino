/*
 PLC-CORE-MDE Project
 Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
 Argentina

 Licensed under PLC-CORE-MDE License v1.0
 See LICENSE file for details
*/
// =============================================================
// PLC_CORE_MDE.ino — v5
// Cambios v5:
//   - Botón SW1 (GPIO18): alterna WiFi ON/OFF con debounce 50ms
//   - WiFi siempre activa al arrancar (necesaria para servidor)
//   - Con PCB: botón apaga/enciende WiFi para reducir temperatura
//   - Sin PCB (protoboard): WiFi siempre ON por defecto
//   - LED Verde (GPIO2): encendido fijo = WiFi activa
//   - LED Amarillo (GPIO5): parpadeo 1Hz=RUN, 5Hz=STOP
//   - El scan PLC nunca se interrumpe al operar el botón WiFi
// =============================================================

#include <Arduino.h>
#include <SPIFFS.h>
#include <WiFi.h>
#include <WebServer.h>

#include "plc_runtime.h"
#include "plc_io.h"
#include "web_server.h"
#include "storage.h"
#include "plc_control.h"
#include "plc_state.h"
#include "plc_modbus.h"
#include "plc_tags.h"

// -----------------------------------------------------------
// Configuración red
// -----------------------------------------------------------
const char* AP_SSID = "PLC_CORE_MDE";
const char* AP_PASS = "12345678";

// -----------------------------------------------------------
// Control de WiFi por botón (GPIO18 = SW1 en el PCB)
// WiFi siempre activa al arrancar — el botón la puede apagar
// para reducir temperatura y liberar recursos del ESP32.
// En protoboard sin PCB: este comportamiento es idéntico,
// WiFi arranca activa y el botón en GPIO18 puede apagarla
// si está conectado; si no hay botón, WiFi permanece siempre ON.
// -----------------------------------------------------------
#define BTN_WIFI_PIN    18          // GPIO18 = SW1
#define BTN_DEBOUNCE_MS 50          // tiempo de debounce en ms

static volatile bool wifiEnabled = true;  // estado actual del WiFi
static bool apRunning = false;            // AP levantado o no

WebServer server(80);

// -----------------------------------------------------------
// MIME / archivos SPIFFS
// -----------------------------------------------------------
static String getContentType(const String& f)
{
    if (f.endsWith(".html")) return "text/html";
    if (f.endsWith(".css"))  return "text/css";
    if (f.endsWith(".js"))   return "application/javascript";
    if (f.endsWith(".json")) return "application/json";
    if (f.endsWith(".png"))  return "image/png";
    return "text/plain";
}

static bool handleFile(String path)
{
    if (path.endsWith("/")) path += "index.html";
    File f = SPIFFS.open(path, "r");
    if (!f) return false;
    server.streamFile(f, getContentType(path));
    f.close();
    return true;
}

static void handleNotFound()
{
    if (!handleFile(server.uri()))
        server.send(404, "text/plain", "Not found");
}

// -----------------------------------------------------------
// Endpoint: estado del PLC (para monitor.html)
// -----------------------------------------------------------
static void handleStatus()
{
    // Lee estado IO físico en tiempo real
    String json = "{";
    json += "\"mode\":\"" + String(plcMode == PLC_RUN ? "RUN" : "STOP") + "\",";
    json += "\"nodes\":" + String(nodeCount) + ",";
    json += "\"wifi\":" + String(wifiEnabled ? "true" : "false") + ",";

    // Entradas digitales
    json += "\"io\":{\"in\":[";
    for (int i = 0; i < NUM_INPUTS; i++) {
        json += String(plcReadInput(i) ? 1 : 0);
        if (i < NUM_INPUTS-1) json += ",";
    }
    // Entradas analógicas
    json += "],\"ai\":[";
    for (int i = 0; i < NUM_ANALOG; i++) {
        json += String(plcReadAnalog(i));
        if (i < NUM_ANALOG-1) json += ",";
    }
    // Salidas: nodes[i].state ya está actualizado en FASE 5 del scan
    json += "],\"out\":[";
    if (xSemaphoreTake(plcMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
        bool outState[4] = {false,false,false,false};
        const char* outNames[4] = {"output1","output2","output3","output4"};
        for (int ni = 0; ni < nodeCount; ni++) {
            for (int oi = 0; oi < 4; oi++) {
                if (nodes[ni].name == outNames[oi])
                    outState[oi] = nodes[ni].state; // directo, ya propagado
            }
        }
        xSemaphoreGive(plcMutex);
        for (int oi = 0; oi < 4; oi++) {
            json += String(outState[oi] ? 1 : 0);
            if (oi < 3) json += ",";
        }
    } else {
        json += "0,0,0,0";
    }
    json += "]}}";
    server.send(200, "application/json", json);
}

// Endpoint /nodes: estado completo de todos los nodos runtime
static void handleNodes()
{
    if (xSemaphoreTake(plcMutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        server.send(503, "application/json", "{\"error\":\"busy\"}");
        return;
    }
    String json = "{\"nodes\":[";
    for (int i = 0; i < nodeCount; i++) {
        if (i > 0) json += ",";
        json += "{";
        json += "\"id\":" + String(nodes[i].id) + ",";
        json += "\"name\":\"" + nodes[i].name + "\",";
        json += "\"state\":" + String(nodes[i].state ? "true" : "false") + ",";
        json += "\"intValue\":" + String(nodes[i].intValue) + ",";
        json += "\"input1\":" + String(nodes[i].input1) + ",";
        json += "\"input2\":" + String(nodes[i].input2) + ",";
        json += "\"preset\":" + String(nodes[i].preset) + ",";
        json += "\"timerRunning\":" + String(nodes[i].timerRunning ? "true" : "false");
        json += "}";
    }
    json += "]}";
    xSemaphoreGive(plcMutex);
    server.send(200, "application/json", json);
}

// -----------------------------------------------------------
// Task PLC — Core 1
// -----------------------------------------------------------
static void plcTask(void*)
{
    while (true)
    {
        plcScan();
        vTaskDelay(10 / portTICK_PERIOD_MS); // scan cada 10ms = 100Hz
    }
}

// -----------------------------------------------------------
// apStart / apStop — levantar o bajar el Access Point WiFi
// -----------------------------------------------------------
static void apStart()
{
    if (apRunning) return;
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    server.begin();
    apRunning = true;
    Serial.println("[WIFI] AP encendido");
}

static void apStop()
{
    if (!apRunning) return;
    server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    apRunning = false;
    Serial.println("[WIFI] AP apagado — PLC sigue en RUN");
}

// -----------------------------------------------------------
// Task LEDs + Botón WiFi — Core 0
//
// Responsabilidades:
//   1. Leer SW1 (GPIO18) con debounce de 50ms
//      → cada pulsación alterna WiFi ON/OFF
//   2. LED Verde (GPIO2):  encendido fijo = WiFi activa
//   3. LED Amarillo (GPIO5): parpadeo 1Hz = RUN, 5Hz = STOP
//
// El scan PLC (Core 1) NO se afecta en ningún caso.
// -----------------------------------------------------------
static void ledTask(void*)
{
    // Configurar botón con pull-up interno
    // (el PCB tiene R5=10K pull-up externo, pero el interno no daña)
    pinMode(BTN_WIFI_PIN, INPUT_PULLUP);

    bool statusLedState  = false;
    bool lastBtnRaw      = HIGH;   // HIGH = no presionado (pull-up)
    bool btnStable       = HIGH;
    unsigned long btnLastChange = 0;

    while (true)
    {
        unsigned long now = millis();

        // ── Debounce del botón ──────────────────────────────
        bool btnRaw = digitalRead(BTN_WIFI_PIN);

        if (btnRaw != lastBtnRaw)
        {
            // Hubo cambio: reiniciar contador de debounce
            btnLastChange = now;
            lastBtnRaw = btnRaw;
        }

        if ((now - btnLastChange) >= BTN_DEBOUNCE_MS)
        {
            // Estado estabilizado
            if (btnStable == HIGH && btnRaw == LOW)
            {
                // Flanco descendente confirmado → alternar WiFi
                wifiEnabled = !wifiEnabled;
            }
            btnStable = btnRaw;
        }

        // ── Sincronizar estado WiFi (botón físico o endpoint web) ──
        // apStart/apStop se llaman aquí para que siempre ocurran
        // fuera del contexto del servidor HTTP.
        if (wifiEnabled && !apRunning)
        {
            apStart();
        }
        else if (!wifiEnabled && apRunning)
        {
            apStop();
        }

        // ── LED Verde: estado WiFi ──────────────────────────
        plcSetWifiLed(apRunning);

        // ── LED Amarillo: estado PLC ────────────────────────
        // 1Hz en RUN (toggle cada 500ms), 5Hz en STOP (toggle cada 100ms)
        uint32_t blinkMs = (plcMode == PLC_RUN) ? 500 : 100;
        statusLedState = !statusLedState;
        plcSetStatusLed(statusLedState);

        vTaskDelay(blinkMs / portTICK_PERIOD_MS);
    }
}

// -----------------------------------------------------------
// SETUP
// -----------------------------------------------------------
void setup()
{
    Serial.begin(115200);
    Serial.println("\n[PLC-CORE-MDE v5]");

    // SPIFFS
    if (!SPIFFS.begin(true))
    {
        Serial.println("[ERROR] SPIFFS mount failed");
        while(1) vTaskDelay(1000 / portTICK_PERIOD_MS);
    }

    // IO físico
    plcIOInit();

    // Sistema de tags
    tagsInit();
    tagsLoad();

    // RS485 / Modbus RTU
    modbusInit();
    modbusStartDiscovery(); // Auto-discovery al arrancar
    // Para forzar un módulo específico (descomentar):
    // modbusRegisterSlave(1, MOD_DI8);  // Dirección 1: 8 DI
    // modbusRegisterSlave(2, MOD_DO8);  // Dirección 2: 8 DO
    // modbusRegisterSlave(3, MOD_AI4);  // Dirección 3: 4 AI
    // modbusRegisterSlave(4, MOD_AO4);  // Dirección 4: 4 AO

    // Mutex + parse programa guardado
    plcMutex = xSemaphoreCreateMutex();
    String json = loadProgram();
    parseProgram(json);

    // Arrancar en RUN automáticamente
    plcRun();

    // WiFi AP — siempre activo al arrancar
    // El botón SW1 (GPIO18) puede apagarlo después del boot
    apStart();
    Serial.printf("[WIFI] AP: %s  IP: %s\n", AP_SSID,
                  WiFi.softAPIP().toString().c_str());

    // Rutas web
    server.onNotFound(handleNotFound);
    server.on("/status",      HTTP_GET, handleStatus);
    server.on("/wifi/status", HTTP_GET, []() {
        String j = String("{\"wifi\":") + (wifiEnabled ? "true" : "false") + "}";
        server.send(200, "application/json", j);
    });
    server.on("/wifi/toggle", HTTP_GET, []() {
        // Nota: apStop() no se puede llamar aquí porque cortaría
        // la conexión antes de enviar la respuesta.
        // La ledTask detecta el cambio de wifiEnabled y actúa.
        wifiEnabled = !wifiEnabled;
        String j = String("{\"wifi\":") + (wifiEnabled ? "true" : "false") + "}";
        server.send(200, "application/json", j);
    });
    server.on("/nodes",  HTTP_GET, handleNodes);

    server.on("/save", HTTP_POST, handleSave);

    server.on("/load", HTTP_GET, []() {
        File f = SPIFFS.open("/program.json", "r");
        if (!f) { server.send(200, "application/json", "{}"); return; }
        // streamFile no copia el programa a RAM (un envelope grande llega a ~77 KB)
        server.streamFile(f, "application/json");
        f.close();
    });

    server.on("/modbus/status", HTTP_GET, []() {
        char buf[1024];
        modbusGetStatus(buf, sizeof(buf));
        server.send(200, "application/json", buf);
    });

    server.on("/modbus/discover", HTTP_GET, []() {
        modbusStartDiscovery();
        server.send(200, "application/json", "{\"status\":\"discovery_started\"}");
    });

    server.on("/manual", HTTP_GET, []() {
        handleFile("/manual.html");
    });

    server.on("/plc/run",    HTTP_GET, []() { plcRun();    server.send(200,"text/plain","RUN");    });
    server.on("/plc/stop",   HTTP_GET, []() { plcStop();   server.send(200,"text/plain","STOP");   });
    server.on("/plc/reload", HTTP_GET, []() { plcReload(); server.send(200,"text/plain","RELOAD"); });

    // Tags endpoints
    server.on("/tags/get", HTTP_GET, []() {
        char buf[4096];
        tagsToJSON(buf, sizeof(buf));
        server.send(200, "application/json", buf);
    });
    server.on("/tags/save", HTTP_POST, []() {
        String body = server.arg("plain");
        if (tagsFromJSON(body.c_str())) {
            tagsSave();
            server.send(200, "text/plain", "Tags OK");
        } else {
            server.send(400, "text/plain", "Error JSON tags");
        }
    });

    // IO map: devuelve mapa completo de IO (local + remota) con tags
    // El editor llama esto para construir los botones dinámicamente
    server.on("/io/map", HTTP_GET, []() {
        String json = "{";
        json += "\"local\":{\"DI\":2,\"DO\":4,\"AI\":1},";
        json += "\"remote\":[";
        bool first = true;
        for (int i=0; i<mbSlaveCount; i++) {
            if (!first) json += ",";
            first = false;
            json += "{\"label\":\"" + String(mbSlaves[i].label) + "\",";
            json += "\"di\":" + String(mbSlaves[i].numDI) + ",";
            json += "\"do\":" + String(mbSlaves[i].numDO) + ",";
            json += "\"ai\":" + String(mbSlaves[i].numAI) + ",";
            json += "\"rdiOff\":" + String(mbSlaves[i].rdiOff) + ",";
            json += "\"rdoOff\":" + String(mbSlaves[i].rdoOff) + ",";
            json += "\"raiOff\":" + String(mbSlaves[i].raiOff) + "}";
        }
        json += "]}";
        server.send(200, "application/json", json);
    });

    // server.begin() ya se llama dentro de apStart()
    Serial.println("[WEB] Servidor OK");

    // Task PLC: Core 1, prio 2
    xTaskCreatePinnedToCore(plcTask, "PLC_SCAN", 8192, NULL, 2, NULL, 1);

    // Task LEDs: Core 0, prio 1 (no bloquea al servidor)
    xTaskCreatePinnedToCore(ledTask, "PLC_LEDS", 2048, NULL, 1, NULL, 0);
}

// -----------------------------------------------------------
// LOOP — solo atiende el servidor web (Core 0)
// -----------------------------------------------------------
void loop()
{
    server.handleClient();
    modbusPoll(); // polling RS485 no bloqueante
}
