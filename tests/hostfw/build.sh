#!/bin/sh
# Compila el plc_runtime.cpp REAL del firmware para el host (shims de Arduino en ./shim).
# uso: build.sh [salida] [flags extra]      ARDUINOJSON=<ruta a ArduinoJson/src> (v6.x)
HERE=$(cd "$(dirname "$0")" && pwd)
FW="$HERE/../../firmware"
AJ=${ARDUINOJSON:-"$HERE/../../../deps/ArduinoJson/src"}
OUT=${1:-fwhost}; [ $# -gt 0 ] && shift
g++ -std=c++17 -O1 -DARDUINOJSON_ENABLE_ARDUINO_STRING=1 "$@" -I "$HERE/shim" -I "$HERE/shim/freertos" -I "$FW" -I "$AJ" "$HERE/driver.cpp" "$FW/plc_runtime.cpp" -o "$HERE/$OUT"
