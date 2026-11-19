# Proyectos de ejemplo `.plc`

Para probarlos directamente en el navegador (sin Internet): abrí el editor correspondiente (en el simulador de la PC o en el servidor del ESP32) y usá **Importar proyecto**.

| Archivo | Editor | Qué hace |
|---|---|---|
| `Control_Tanque_FBD.plc` | FBD (`program.html`) | IN1 = nivel bajo, IN2 = nivel alto → RS (reset dominante) → OUT1 (bomba); un TON de 100 ms sobre la bomba → OUT2 (aviso de bomba en marcha). |
| `Control_Tanque_Ladder.plc` | Ladder (`ladder.html`) | `X0` SET `Y0` (nivel bajo arranca la bomba); `X1` RESET `Y0` (nivel alto la para); `Y0` → `Y1` (aviso). |

Comportamiento esperado (lo verifica `tests/t_e7_portable.js` en el firmware real compilado en el host y en el simulador): con X0=1 la bomba enciende y **se mantiene** al soltar X0; con X1=1 se apaga.

Importar **no** guarda en el PLC: después hay que pulsar «Guardar en PLC» y confirmar. Se regeneran con `node tools/make_examples.js` (hechos con los editores reales, no a mano).
