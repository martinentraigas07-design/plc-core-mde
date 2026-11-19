#!/usr/bin/env node
'use strict';
/* PLC-CORE-MDE — Construcción reproducible de firmware/data/ (interfaz que sirve el ESP32)
 *
 *   node tools/build_web.js            genera firmware/data/ desde las páginas de la raíz
 *   node tools/build_web.js --check    no escribe: falla (exit 1) si firmware/data/ no coincide con lo que generaría
 *   node tools/build_web.js --out DIR  genera en otro directorio
 *
 * Fuente de verdad: las páginas HTML de la raíz, js/, style.css, etc. (la misma base que usa la versión web/simulador).
 * Transformaciones para el ESP32 (todas verificadas por tests/t_e7_web.js):
 *   1. se quitan los <script src="simulator/..."> (el simulador intercepta fetch y no debe correr en el PLC real);
 *   2. después de plc_api.js se inyecta plc_api_esp.js (arma /api/memory desde /status + /nodes: el firmware no la implementa);
 *   3. se aplanan las rutas (SPIFFS no tiene directorios y limita el nombre completo a 31 caracteres);
 *   4. se eliminan los @import de Google Fonts (sin Internet; las fuentes caen a sans-serif / monospace);
 *   5. solo se copian los recursos referenciados por las páginas (+ LICENSE.txt, enlazado desde manual.html).
 * No hay marcas de tiempo: la salida es idéntica en cada ejecución.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const PAGES = ['index.html', 'program.html', 'ladder.html', 'monitor.html', 'manual.html', 'about.html'];
const EXTRA = ['LICENSE.txt'];                       // referenciado desde manual.html ("Ver licencia completa")
const INJECT_AFTER = { 'js/api/plc_api.js': 'js/api/plc_api_esp.js' };
const MAX_NAME = 31;                                  // SPIFFS (arduino-esp32): CONFIG_SPIFFS_OBJ_NAME_LEN = 32 incluyendo el '\0'
const SPIFFS_BUDGET_DEFAULT = 1507328;                // "Default 4MB with spiffs": 0x170000
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(ROOT, 'firmware', 'data');

const read = f => fs.readFileSync(path.join(ROOT, f));
const flat = rel => '/' === rel[0] ? rel : path.posix.basename(rel);
const errors = [];
const files = new Map();                              // nombre plano -> {buf, from}
function put(name, buf, from) {
  if (name.length + 1 > MAX_NAME) errors.push(`nombre demasiado largo para SPIFFS (${name.length + 1} > ${MAX_NAME}): /${name}`);
  if (files.has(name) && files.get(name).from !== from) errors.push(`colisión de nombres planos: ${name} <- ${files.get(name).from} y ${from}`);
  files.set(name, { buf, from });
}
function stripFonts(txt) { return txt.replace(/@import\s+url\(\s*['"]?https?:\/\/[^)]*\)\s*;?[ \t]*\r?\n?/g, ''); }
const localRef = u => u && !/^(https?:|mailto:|data:|javascript:|#|\/\/|\/)/.test(u);
const seen = new Set();
function addAsset(rel, via) {
  rel = rel.replace(/^\.\//, '');
  const name = flat(rel);
  if (seen.has(rel)) return name;
  seen.add(rel);
  if (!fs.existsSync(path.join(ROOT, rel))) { errors.push(`recurso inexistente: ${rel} (referenciado desde ${via})`); return name; }
  if (/\.css$/.test(rel)) put(name, Buffer.from(stripFonts(read(rel).toString('utf8'))), rel);
  else put(name, read(rel), rel);
  return name;
}
function transformPage(page) {
  let h = read(page).toString('utf8');
  // 1. simulador fuera (y el comentario que lo rodea)
  h = h.replace(/[ \t]*<script\s+src="simulator\/[^"]*"><\/script>[ \t]*\r?\n/g, '');
  h = h.replace(/[ \t]*<!--\s*[═=─\s]*SIMULADOR PLC-CORE-MDE[^>]*-->[ \t]*\r?\n/g, '');
  h = h.replace(/[ \t]*<!--\s*═{6,}\s*-->[ \t]*\r?\n(?=\s*<script)/g, '');
  // 4. fuentes externas
  h = stripFonts(h);
  // 2. adaptador ESP
  for (const [after, inj] of Object.entries(INJECT_AFTER)) {
    const tag = `<script src="${after}"></script>`;
    if (h.includes(tag)) h = h.replace(tag, tag + `\n<script src="${inj}"></script>`);
  }
  // 3/5. recursos referenciados -> planos
  h = h.replace(/\b(src|href)="([^"#?]+)((?:[?#][^"]*)?)"/g, (m, attr, u, rest) => {
    if (!localRef(u)) return m;
    if (PAGES.includes(u)) return m;                     // enlaces entre páginas (ya planas)
    return `${attr}="${addAsset(u, page)}${rest}"`;
  });
  // inline <style>: url() locales
  return h;
}
for (const p of PAGES) { if (!fs.existsSync(path.join(ROOT, p))) { errors.push('falta la página ' + p); continue; } put(p, Buffer.from(transformPage(p)), p); }
for (const e of EXTRA) addAsset(e, 'EXTRA');
if (!PAGES.every(p => files.has(p))) errors.push('páginas incompletas');
// ── verificación interna de la salida ──────────────────────────────────
const sorted = [...files.keys()].sort();
for (const n of sorted) {
  if (!/\.(html|css|js)$/.test(n) && n !== 'LICENSE.txt') continue;
  const t = files.get(n).buf.toString('utf8');
  if (/\.html$/.test(n)) {
    for (const m of t.replace(/data:[^"')]+/g, '').matchAll(/\b(?:src|href)="([^"#?]+)/g)) {
      if (localRef(m[1]) && !files.has(m[1])) errors.push(`${n}: referencia rota tras aplanar: ${m[1]}`);
      if (/^simulator\//.test(m[1])) errors.push(`${n}: todavía referencia el simulador`);
    }
  }
}
// ── informe ────────────────────────────────────────────────────────────
function spiffsFootprint(n) {                         // estimación: páginas de 256 B con ~251 B útiles + cabecera/índice por archivo
  const pages = Math.ceil(n / 251) + 2; return pages * 256;
}
let total = 0, foot = 0;
const info = { generator: 'tools/build_web.js', maxNameWithSlash: MAX_NAME, files: [] };
for (const n of sorted) {
  const b = files.get(n).buf; total += b.length; foot += spiffsFootprint(b.length);
  info.files.push({ name: n, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16), from: files.get(n).from });
}
info.totalBytes = total; info.estimatedSpiffsBytes = foot; info.estimateNote = 'estimación conservadora (páginas de 256 B); medir con SPIFFS.usedBytes() en el equipo';
const infoBuf = Buffer.from(JSON.stringify(info, null, 1) + '\n');
if (errors.length) { console.error('ERRORES:\n - ' + errors.join('\n - ')); process.exit(2); }
files.set('build_info.json', { buf: infoBuf, from: 'generado' });
if (CHECK) {
  let bad = 0;
  const onDisk = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  for (const [n, f] of files) { const p = path.join(outDir, n); if (!fs.existsSync(p) || !fs.readFileSync(p).equals(f.buf)) { console.error('DIFERENTE: ' + n); bad++; } }
  for (const n of onDisk) if (!files.has(n)) { console.error('SOBRA en firmware/data: ' + n); bad++; }
  console.log(bad ? `firmware/data NO está sincronizado (${bad} diferencias). Ejecutá: node tools/build_web.js` : `firmware/data sincronizado (${files.size} archivos, ${total} B)`);
  process.exit(bad ? 1 : 0);
}
if (fs.existsSync(outDir)) {
  const old = fs.readdirSync(outDir);
  if (old.length && !old.includes('build_info.json') && !args.includes('--force')) { console.error(`${outDir} contiene archivos no generados por esta herramienta (¿interfaz anterior?). Muévalos o use --force.`); process.exit(3); }
  for (const n of old) fs.rmSync(path.join(outDir, n), { recursive: true, force: true });
} else fs.mkdirSync(outDir, { recursive: true });
for (const [n, f] of files) fs.writeFileSync(path.join(outDir, n), f.buf);
console.log(`firmware/data generado: ${files.size} archivos, ${total} B (${(total / 1024).toFixed(1)} KiB); SPIFFS estimado ${foot} B de ${SPIFFS_BUDGET_DEFAULT} B (partición por defecto) = ${(100 * foot / SPIFFS_BUDGET_DEFAULT).toFixed(0)} %`);
