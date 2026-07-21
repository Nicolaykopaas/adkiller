/**
 * Dev-watcher: overvåker kildefilene og bumper version.json ved endringer, slik at
 * utvidelsen laster seg selv på nytt i Chrome (se hot-reload i service-worker.js).
 *
 * Kjør:  npm run dev
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WATCH_DIRS = ['content', 'background', 'popup', 'options', 'rules'];
const WATCH_FILES = ['manifest.json'];

let timer = null;
function bumpSoon(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    spawnSync(process.execPath, [path.join(__dirname, 'bump-version.mjs')], {
      stdio: 'inherit',
    });
    console.log(`  (utløst av ${reason})`);
  }, 200); // debounce
}

for (const dir of WATCH_DIRS) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, { recursive: true }, (_evt, filename) => {
    if (filename === 'version.json') return;
    bumpSoon(`${dir}/${filename}`);
  });
}
for (const f of WATCH_FILES) {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) fs.watch(full, () => bumpSoon(f));
}

console.log('👀 Watcher kjører. Endrer du kildefiler, laster utvidelsen seg selv på nytt (innen ~30s).');
console.log('   Overvåker:', [...WATCH_DIRS, ...WATCH_FILES].join(', '));
