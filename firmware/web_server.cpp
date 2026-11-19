/*
 PLC-CORE-MDE Project
 Copyright (c) 2026 Martín Entraigas / PLC-CORE-MDE
 Argentina

 Licensed under PLC-CORE-MDE License v1.0
 See LICENSE file for details
*/
#include "web_server.h"
#include <WebServer.h>
#include <SPIFFS.h>
#include "plc_control.h"


extern WebServer server;

void handleSave()
{
  if (server.method() != HTTP_POST)
  {
    server.send(405, "text/plain", "Method Not Allowed");
    return;
  }

  const String& body = server.arg("plain");

  if (body.length() == 0)
  {
    server.send(400, "text/plain", "Empty body");
    return;
  }

  // Escritura transaccional: primero a un archivo temporal y recién cuando
  // quedó completo reemplaza al programa. Antes se abría /program.json en
  // modo "w" (lo trunca) y un corte o un error de escritura dejaba el PLC
  // sin programa.
  File f = SPIFFS.open("/program.tmp", "w");

  if (!f)
  {
    server.send(500, "text/plain", "Error open file");
    return;
  }

  size_t written = f.print(body);
  f.close();

  if (written != body.length())
  {
    SPIFFS.remove("/program.tmp");
    server.send(500, "text/plain", "Write incomplete (SPIFFS full?)");
    return;
  }

  SPIFFS.remove("/program.json");
  if (!SPIFFS.rename("/program.tmp", "/program.json"))
  {
    server.send(500, "text/plain", "Rename failed");
    return;
  }

  server.send(200, "text/plain", "Saved OK");
}
