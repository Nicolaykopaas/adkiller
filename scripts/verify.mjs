/**
 * Verifiseringsharnisk — kjøres før hver commit (`npm run verify`).
 *
 * Fanger regresjoner automatisk, inkludert de to reelle feilene vi har hatt:
 *   - redirect-regler som peker på ressurser som ikke finnes (aviser lastet ikke)
 *   - unlock-motor uten vegg-deteksjon (ødela scrolling på Facebook)
 *
 * Exit-kode 1 hvis noe feiler, slik at en autonom loop ikke kan pushe ødelagt kode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => path.join(ROOT, ...a);

let failures = 0;
let checks = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => {
  checks++;
  console.log(`  ✓ ${msg}`);
};

function section(name) {
  console.log(`\n› ${name}`);
}

// ---------- 1. manifest ----------
section('Manifest');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(p('manifest.json'), 'utf8'));
  ok('manifest.json er gyldig JSON');
} catch (err) {
  fail(`manifest.json kunne ikke parses: ${err.message}`);
  process.exit(1);
}

const refs = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
];
for (const cs of manifest.content_scripts || []) refs.push(...(cs.js || []));
for (const rr of manifest.declarative_net_request?.rule_resources || []) refs.push(rr.path);

const missingRefs = refs.filter((r) => r && !fs.existsSync(p(r)));
if (missingRefs.length) fail(`manglende filer i manifestet: ${missingRefs.join(', ')}`);
else ok(`alle ${refs.length} manifest-referanser finnes`);

// web_accessible_resources: sjekk ikke-glob-oppføringer
for (const entry of manifest.web_accessible_resources || []) {
  for (const res of entry.resources || []) {
    if (res.includes('*')) {
      const dir = p(path.dirname(res));
      if (!fs.existsSync(dir)) fail(`web_accessible glob peker på manglende mappe: ${res}`);
    } else if (!fs.existsSync(p(res))) {
      fail(`web_accessible ressurs mangler: ${res}`);
    }
  }
}
ok('web_accessible_resources er konsistent');

// ---------- 2. JS-syntaks ----------
section('JS-syntaks');
const jsFiles = [];
for (const dir of ['background', 'content', 'popup', 'options', 'scripts']) {
  const d = p(dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.js') || f.endsWith('.mjs')) jsFiles.push(path.join(dir, f));
  }
}
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', p(f)], { stdio: 'pipe' });
  } catch (err) {
    fail(`syntaksfeil i ${f}: ${String(err.stderr || err).slice(0, 200)}`);
  }
}
ok(`${jsFiles.length} JS-filer passerte syntakssjekk`);

// ---------- 3. DNR-regelsett ----------
section('DNR-regelsett');
const CHROME_MAX_REGEX = 1000;
let totalRegex = 0;
let redirectMissing = 0;
let redirectOk = 0;

for (const rr of manifest.declarative_net_request?.rule_resources || []) {
  const file = p(rr.path);
  if (!fs.existsSync(file)) {
    fail(`regelsett mangler: ${rr.path} (kjør npm run build)`);
    continue;
  }
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${rr.path} er ugyldig JSON: ${err.message}`);
    continue;
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    fail(`${rr.path} er tomt`);
    continue;
  }

  const ids = new Set();
  let dupes = 0;
  for (const r of rules) {
    if (ids.has(r.id)) dupes++;
    ids.add(r.id);
    if (r.condition?.regexFilter) totalRegex++;
    const ep = r.action?.redirect?.extensionPath;
    if (ep) {
      if (fs.existsSync(p(ep.replace(/^\//, '')))) redirectOk++;
      else redirectMissing++;
    }
  }
  if (dupes) fail(`${rr.path} har ${dupes} duplikate regel-id-er`);
  else ok(`${rr.path}: ${rules.length} regler, unike id-er`);
}

if (totalRegex > CHROME_MAX_REGEX) fail(`${totalRegex} regex-regler > Chromes grense ${CHROME_MAX_REGEX}`);
else ok(`${totalRegex} regex-regler (under grensen på ${CHROME_MAX_REGEX})`);

// REGRESJONSVAKT: aviser lastet ikke fordi redirect-ressurser manglet
if (redirectMissing > 0) {
  fail(`${redirectMissing} redirect-regler peker på ressurser som IKKE finnes ` +
       '(dette brøt avis-sider tidligere — kjør npm run build)');
} else {
  ok(`alle ${redirectOk} redirect-regler har en eksisterende stub-ressurs`);
}

// ---------- 4. Kosmetiske regler ----------
section('Kosmetiske regler');
const specPath = p('rules', 'specific-hide.json');
if (!fs.existsSync(specPath)) {
  fail('rules/specific-hide.json mangler (kjør npm run build)');
} else {
  const data = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (data.v !== 2) fail(`specific-hide.json har uventet skjemaversjon: ${data.v}`);
  else if (!Array.isArray(data.rules) || !data.index) fail('specific-hide.json mangler rules/index');
  else {
    let badRef = 0;
    for (const key of Object.keys(data.index)) {
      for (const i of data.index[key]) {
        if (!data.rules[i]) badRef++;
      }
    }
    if (badRef) fail(`${badRef} indeks-oppføringer peker på ikke-eksisterende regler`);
    else ok(`${data.rules.length} regler i ${Object.keys(data.index).length} bøtter, indeks konsistent`);
  }
}

const genPath = p('rules', 'generic-hide.css');
if (!fs.existsSync(genPath)) fail('rules/generic-hide.css mangler');
else {
  const css = fs.readFileSync(genPath, 'utf8');
  if (/:contains\(|:-abp-|:xpath\(|:has-text\(/.test(css)) {
    fail('generic-hide.css inneholder ikke-native selektorer (ville ødelagt CSS-grupper)');
  } else ok('generic-hide.css inneholder kun native selektorer');
}

// ---------- 5. Regresjonsvakter i kildekoden ----------
section('Regresjonsvakter');
const unlockSrc = fs.readFileSync(p('content', 'reader-unlock.js'), 'utf8');
// Facebook-feilen: auto-modus må kreve at en vegg faktisk finnes
if (!/function detectWall/.test(unlockSrc) || !/!aggressive && !detectWall\(\)/.test(unlockSrc)) {
  fail('reader-unlock.js mangler vegg-deteksjon i auto-modus (brøt scrolling på Facebook)');
} else ok('unlock-motoren krever vegg-deteksjon i auto-modus');

if (!/APP_HOSTS/.test(unlockSrc)) fail('reader-unlock.js mangler APP_HOSTS-unntak');
else ok('unlock-motoren hopper over app-sider i auto-modus');

// Hot-reload må ALDRI laste brukerens faner på nytt (kastet brukeren ut av videoer).
const swSrc = fs.readFileSync(p('background', 'service-worker.js'), 'utf8');
if (/chrome\.tabs\.reload/.test(swSrc)) {
  fail('service-worker.js kaller chrome.tabs.reload — hot-reload må aldri laste brukerens faner');
} else ok('hot-reload laster aldri brukerens faner');

// Feilrapporten må ALDRI endre blokkeringen — ellers maskerer den tilstanden vi måler.
{
  const start = swSrc.indexOf("case 'reportProblem'");
  if (start === -1) {
    fail('finner ikke reportProblem-handleren i service-worker.js');
  } else {
    const rest = swSrc.slice(start + 10);
    const end = rest.indexOf("case '");
    const block = end === -1 ? rest : rest.slice(0, end);
    if (/storage\.local\.set\(\s*\{[^}]*whitelist/s.test(block) || /syncEverything\(\)/.test(block)) {
      fail('reportProblem endrer whitelist/blokkering — rapporten skal kun observere');
    } else ok('feilrapporten endrer ikke blokkeringen');
  }
}

// YouTube: ren JSON-pruning er ikke nok — motoren MÅ også hoppe over annonser i
// spilleren (.ad-showing -> spol/hopp). Ellers vises annonser selv med funksjonen på.
if (fs.existsSync(p('content', 'youtube.js'))) {
  const ytSrc = fs.readFileSync(p('content', 'youtube.js'), 'utf8');
  if (!/ad-showing/.test(ytSrc) || !/ytp-ad-skip-button/.test(ytSrc)) {
    fail('youtube.js mangler annonse-hopping i spilleren (JSON-pruning alene er ikke nok)');
  } else ok('youtube.js hopper over annonser i spilleren');

  // YTELSE: en subtree-MutationObserver på YouTube-DOM-en gjorde siden treg.
  if (/new MutationObserver/.test(ytSrc)) {
    fail('youtube.js bruker MutationObserver — gjorde YouTube tregt, bruk intervall');
  } else ok('youtube.js unngår tung MutationObserver på YouTube');

  // YouTube skal ALLTID være på — registrert statisk i manifestet, ingen bryter.
  const ytStatic = (manifest.content_scripts || []).some((cs) =>
    (cs.js || []).some((j) => j.endsWith('youtube.js')),
  );
  if (!ytStatic) fail('content/youtube.js er ikke registrert statisk i manifestet (skal alltid være på)');
  else ok('YouTube-blokkering er alltid på (statisk content-script)');
}

const popupBlockerSrc = fs.readFileSync(p('content', 'popup-blocker.js'), 'utf8');
// window.open må være en accessor (ikke writable:false) for å unngå TypeError
if (/writable:\s*false/.test(popupBlockerSrc)) {
  fail('popup-blocker.js låser window.open med writable:false (kan kaste TypeError på ekte sider)');
} else ok('window.open-overstyringen er kompatibel (accessor)');

// ---------- 5b. Test-harness laster utvidelsen riktig ----------
// Moderne Chrome ignorerer --load-extension stille, så en harness som bruker det
// måler en UBESKYTTET nettleser og gir falske "ads slipper gjennom"-resultater.
// Harnessene MÅ laste via CDP Extensions.loadUnpacked.
section('Test-harness');
for (const file of ['scripts/adtest.mjs', 'scripts/dnr-probe.mjs']) {
  if (!fs.existsSync(p(file))) continue;
  const src = fs.readFileSync(p(file), 'utf8');
  if (/['"`]--load-extension/.test(src)) {
    fail(`${file} bruker --load-extension (ignoreres av moderne Chrome — måler ubeskyttet nettleser)`);
  } else if (!/Extensions\.loadUnpacked/.test(src)) {
    fail(`${file} laster ikke utvidelsen via Extensions.loadUnpacked`);
  } else ok(`${file} laster utvidelsen korrekt via CDP`);
}

// ---------- 6. Meldingsprotokoll ----------
// Fanger protokoll-drift: UI/content som sender en meldingstype uten handler i
// service workeren (lett å innføre når UI-arbeid gjøres separat fra bakgrunnen).
section('Meldingsprotokoll');
const handled = new Set([...swSrc.matchAll(/case\s+'([A-Za-z]+)'/g)].map((m) => m[1]));
for (const file of [
  'popup/popup.js',
  'options/options.js',
  'content/cosmetic.js',
  'content/reader-unlock.js',
  'content/element-picker.js',
  'content/state-bridge.js',
]) {
  if (!fs.existsSync(p(file))) continue;
  const src = fs.readFileSync(p(file), 'utf8');
  const sent = [...new Set([...src.matchAll(/type:\s*'([A-Za-z]+)'/g)].map((m) => m[1]))];
  const unknown = sent.filter((t) => !handled.has(t));
  if (unknown.length) fail(`${file} sender meldinger uten handler i bakgrunnen: ${unknown.join(', ')}`);
  else if (sent.length) ok(`${file}: ${sent.length} meldingstyper har handler`);
}

// ---------- oppsummering ----------
console.log('\n' + '─'.repeat(60));
if (failures) {
  console.error(`✗ ${failures} feil funnet (${checks} sjekker passerte).`);
  process.exit(1);
}
console.log(`✓ Alt OK — ${checks} sjekker passerte.`);
