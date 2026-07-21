/**
 * Skriver version.json med et nytt tidsstempel. Service workeren poller denne fila
 * og laster utvidelsen på nytt (hot-reload) når verdien endres.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, '..', 'version.json');
const build = Date.now();
fs.writeFileSync(file, JSON.stringify({ build }) + '\n');
console.log('version.json bumpet ->', build);
