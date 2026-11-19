#!/bin/sh
# Ejecuta TODAS las pruebas de host (no requieren ESP32). Requiere: node, g++ y ArduinoJson 6.x
#   ARDUINOJSON=/ruta/a/ArduinoJson/src ./tests/run_all.sh
cd "$(dirname "$0")" || exit 1
AJ=${ARDUINOJSON:-../../deps/ArduinoJson/src}
[ -d "$AJ" ] || { echo "Falta ArduinoJson 6.x: definí ARDUINOJSON=/ruta/a/ArduinoJson/src"; exit 2; }
export ARDUINOJSON="$AJ"
./hostfw/build.sh fwhost || exit 1
./hostfw/build.sh fwhost_smallcap -DPLC_JSON_CAP_1=2048 -DPLC_JSON_CAP_2=6000 -DPLC_JSON_CAP_3=9000 || exit 1
g++ -std=c++17 -I "$AJ" size/measure.cpp -o size/measure || exit 1
node t_persist_gen.js >/dev/null 2>&1
FAIL=0
for t in t_diag1 t_diag2 t_stage1 t_order t_ladder t_ladder2 t_ladder3 t_rt t_persist t_e1 t_irchk t_e2 t_ui t_e4_conv t_e4_route t_e4_compat t_e4_protect t_e4b_feedback t_e4c_feedback t_e4b_sr t_e4b_pwm t_e5_manual t_e6_audit t_e7_web manual/ch01_03 manual/ch04 manual/ch05 manual/ch06 manual/ch07 manual/ch08 manual/ch10 manual/ch11_5box t_e7_portable; do
  out=$(node $t.js 2>&1)
  p=$(echo "$out" | grep -c '^PASS'); f=$(echo "$out" | grep -c '^FAIL')
  case $t in t_ladder) p=$(echo "$out" | sed -n 's/.*passed= *\([0-9]*\) failed= *\([0-9]*\).*/\1/p' | head -1); f=$(echo "$out" | sed -n 's/.*passed= *\([0-9]*\) failed= *\([0-9]*\).*/\2/p' | head -1);; esac
  printf '%-18s PASS %-4s FAIL %s\n' "$t" "$p" "$f"
  [ "$f" != "0" ] && FAIL=1
done
exit $FAIL
