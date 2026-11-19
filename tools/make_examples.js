#!/usr/bin/env node
'use strict';
// Genera (o con --check verifica) los proyectos de ejemplo examples/*.plc usando los editores REALES en jsdom,
// exactamente como los exportaría un usuario desde el simulador. Herramienta de desarrollo: requiere jsdom (tests/package.json).
//   node tools/make_examples.js            escribe examples/Control_Tanque_FBD.plc y examples/Control_Tanque_Ladder.plc
//   node tools/make_examples.js --check    falla si los archivos del repositorio difieren de lo que se regenera
const fs = require('fs'), path = require('path');
const L = require('../tests/portable_lib');
const OUT = path.join(L.R, 'examples');
(async () => {
  const check = process.argv.includes('--check');
  const jobs = [];
  { const S = await L.bootPage('program.html', 'sim'); S.w.document.getElementById('proj-name').value = 'Control Tanque (FBD)'; L.buildTankFbd(S.w, 100); await L.tick(100);
    S.w.exportProject(); jobs.push([S.w.__dl.name, S.w.__dl.text]); S.w.close(); }
  { const S = await L.bootPage('ladder.html', 'sim'); S.w.document.getElementById('proj-name').value = 'Control Tanque (Ladder)'; L.buildTankLadder(S.w); await L.tick(100);
    S.w.exportProject(); jobs.push([S.w.__dl.name, S.w.__dl.text]); S.w.close(); }
  let bad = 0;
  for (const [name, text] of jobs) {
    const f = path.join(OUT, name);
    if (check) { const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (cur !== text) { console.error('DIFIERE: examples/' + name); bad++; } else console.log('ok examples/' + name); }
    else { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(f, text); console.log('escrito examples/' + name + ' (' + text.length + ' bytes)'); }
  }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
