/**
 * Bygger filter-ressursene som utvidelsen bruker:
 *
 *  1) Nettverksblokkering (DNR): kopierer/merger forhåndsbygde AdGuard DNR-regelsett
 *     fra @adguard/dnr-rulesets til rules/ruleset_ads|privacy|annoyances.json.
 *  2) Kosmetisk skjuling: laster ned EasyList + EasyPrivacy, parser element-hiding-
 *     reglene med @ghostery/adblocker, og skriver rules/generic-hide.css +
 *     rules/specific-hide.json som content-scriptet bruker.
 *
 * Kjør:  npm run build:filters
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { parseFilters } from '@ghostery/adblocker';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RULES_DIR = path.join(ROOT, 'rules');

// AdGuard sine ferdigbygde chromium-mv3 DNR-regelsett ligger her (i dist/, ikke pakkerot):
const ADGUARD_DECLARATIVE = path.join(
  ROOT,
  'node_modules',
  '@adguard',
  'dnr-rulesets',
  'dist',
  'filters',
  'chromium-mv3',
  'declarative',
);

// AdGuard-filter-IDer -> vårt regelsett. IDer verifisert mot filters_i18n.json.
//   2  = AdGuard Base (annonser, ~EasyList)
//   3  = AdGuard Tracking Protection (~EasyPrivacy)
//   18 = Cookie Notices, 19 = Popups, 21 = Other Annoyances
const NETWORK_RULESETS = {
  'ruleset_ads.json': [2],
  'ruleset_privacy.json': [3],
  'ruleset_annoyances.json': [19, 18, 21],
};

// Kosmetiske lister (element-hiding). AdGuard-DNR dekker nettverk; her henter vi
// bare ##-regler. Nordic-lista dekker norske sider (VG «annonsørinnhold» osv.).
const COSMETIC_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/DandelionSprout/adfilt/master/NorwegianList.txt',
  'https://raw.githubusercontent.com/liamengland1/miscfilters/master/antipaywall.txt',
];

// Pseudo-klasser som IKKE er gyldig CSS i nettleseren (prosedyre-/utvidede selektorer).
// :has() er native og beholdes; disse må droppes så de ikke ødelegger CSS-regler.
const NON_NATIVE_SELECTOR = /:(?:-abp-|contains|has-text|matches-css|matches-media|matches-path|matches-property|xpath|upward|nth-ancestor|min-text-length|watch-attr|remove|if|if-not)\b|:style\(/i;

const CHROME_MAX_REGEX_RULES = 1000; // per utvidelse, globalt

// Redirect-ressurser (nøytraliserte stubber) fra @adguard/scriptlets.
const REDIRECT_SRC_DIR = path.join(
  ROOT, 'node_modules', '@adguard', 'scriptlets', 'dist', 'redirect-files',
);
const WAR_REDIRECTS_DIR = path.join(ROOT, 'web-accessible-resources', 'redirects');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readRuleset(id) {
  const p = path.join(ADGUARD_DECLARATIVE, `ruleset_${id}`, `ruleset_${id}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Fant ikke AdGuard-regelsett ${id} på ${p}. Kjørte du "npm install"?`,
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * AdGuard-regler kan omdirigere til pakkede "redirect"-ressurser
 * (action.redirect.extensionPath -> /web-accessible-resources/redirects/*.js).
 * Disse serverer NØYTRALISERTE stubber (f.eks. tom adsbygoogle.js) slik at sider som
 * venter på annonsescriptet fortsatt rendrer. Blokkerer man dem i stedet, kan sider
 * (typisk aviser) henge eller aldri vise innholdet.
 *
 * Vi kopierer derfor ressursene fra @adguard/scriptlets og beholder redirectene.
 * Kun redirects vi IKKE har en fil for gjøres om til block.
 */
function copyRedirectResources() {
  ensureDir(WAR_REDIRECTS_DIR);
  if (!fs.existsSync(REDIRECT_SRC_DIR)) {
    console.warn(`  ⚠ Fant ikke ${REDIRECT_SRC_DIR} — redirects blir til block-regler.`);
    return 0;
  }
  let n = 0;
  for (const name of fs.readdirSync(REDIRECT_SRC_DIR)) {
    fs.copyFileSync(path.join(REDIRECT_SRC_DIR, name), path.join(WAR_REDIRECTS_DIR, name));
    n++;
  }
  return n;
}

function haveRedirectResource(extensionPath) {
  const name = String(extensionPath).split('/').pop();
  return fs.existsSync(path.join(WAR_REDIRECTS_DIR, name));
}

function sanitizeRedirect(rule) {
  if (rule.action?.type !== 'redirect') return rule;
  const r = rule.action.redirect || {};
  if (r.extensionPath) {
    // Behold redirecten hvis vi faktisk har ressursen; ellers blokker.
    return haveRedirectResource(r.extensionPath) ? rule : { ...rule, action: { type: 'block' } };
  }
  if (r.url) return { ...rule, action: { type: 'block' } }; // ekstern URL — ikke ønskelig
  return rule; // transform-baserte redirects er trygge
}

/** Slår sammen flere AdGuard-regelsett til ett og gir hver regel unik id. */
function buildNetworkRuleset(ids) {
  let nextId = 1;
  const merged = [];
  let redirectsConverted = 0;
  for (const id of ids) {
    for (const rule of readRuleset(id)) {
      const clean = sanitizeRedirect(rule);
      if (clean !== rule) redirectsConverted++;
      merged.push({ ...clean, id: nextId++ });
    }
  }
  buildNetworkRuleset.lastRedirectsConverted = redirectsConverted;
  return merged;
}

function countRegex(rules) {
  let n = 0;
  for (const r of rules) if (r.condition?.regexFilter) n++;
  return n;
}

function buildNetworkRulesets() {
  const copied = copyRedirectResources();
  console.log(`› Kopierte ${copied} redirect-ressurser til web-accessible-resources/redirects/`);
  console.log('› Bygger nettverks-regelsett (DNR) fra AdGuard …');
  let totalRules = 0;
  let totalRegex = 0;
  for (const [file, ids] of Object.entries(NETWORK_RULESETS)) {
    const rules = buildNetworkRuleset(ids);
    const regex = countRegex(rules);
    const converted = buildNetworkRuleset.lastRedirectsConverted;
    totalRules += rules.length;
    totalRegex += regex;
    fs.writeFileSync(path.join(RULES_DIR, file), JSON.stringify(rules));
    console.log(
      `  ${file.padEnd(26)} ${String(rules.length).padStart(7)} regler  (${regex} regex, ${converted} redirect→block)  fra AdGuard ${ids.join(', ')}`,
    );
  }
  console.log(`  Sum: ${totalRules} regler, ${totalRegex} regex-regler.`);
  if (totalRegex > CHROME_MAX_REGEX_RULES) {
    console.warn(
      `  ⚠ Advarsel: ${totalRegex} regex-regler overstiger Chromes grense på ${CHROME_MAX_REGEX_RULES}. ` +
        'Chrome vil deaktivere de overskytende. Vurder å fjerne et regelsett.',
    );
  }
}

// Nedlasting via node:https (stabilt) med retry. Følger redirects.
function httpsGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'best-adblock-build' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('For mange redirects'));
        const next = new URL(headers.location, url).toString();
        return resolve(httpsGet(next, redirectsLeft - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
  });
}

async function fetchText(url, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await httpsGet(url);
    } catch (err) {
      if (i === attempts) throw new Error(`Klarte ikke laste ned ${url}: ${err.message}`);
      const wait = 500 * i;
      console.log(`  … forsøk ${i} feilet (${err.message}), prøver igjen om ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Henter domenedelen (før ## / #@#) fra en rå kosmetisk filterlinje. */
function parseDomainPart(rawLine) {
  const m = rawLine.match(/^([^#]*)#@?\??\$?#/);
  const domainStr = m ? m[1] : '';
  const include = [];
  const exclude = [];
  if (domainStr) {
    for (const part of domainStr.split(',')) {
      const d = part.trim();
      if (!d) continue;
      if (d.startsWith('~')) exclude.push(d.slice(1).toLowerCase());
      else include.push(d.toLowerCase());
    }
  }
  return { include, exclude };
}

// Skjema-versjon for specific-hide.json (så content-scriptet kan avvise gammelt format).
const SPECIFIC_SCHEMA = 2;

/** Domenenøkkel = siste to labels; jokertegn/entiteter havner i "*"-bøtta. */
function domainKey(host) {
  if (!host || host.includes('*')) return '*';
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

/**
 * Bygg { rules: [...], index: { nøkkel -> [indekser] } }.
 * Hver regel lagres ÉN gang i `rules`; bøttene peker på indekser (kompakt).
 */
function indexSpecificRules(specific) {
  const rules = [];
  const index = Object.create(null);
  for (const r of specific) {
    const rule = { s: r.s, h: r.h };
    if (r.not && r.not.length) rule.not = r.not;
    if (r.style && r.style !== 'display: none !important') rule.style = r.style;
    const i = rules.push(rule) - 1;
    const keys = new Set(r.h.map(domainKey));
    for (const key of keys) {
      (index[key] || (index[key] = [])).push(i);
    }
  }
  return { rules, index };
}

async function buildCosmetic() {
  console.log('› Bygger kosmetiske skjuleregler fra EasyList …');
  let raw = '';
  for (const url of COSMETIC_LISTS) {
    console.log(`  laster ned ${url}`);
    raw += '\n' + (await fetchText(url));
  }

  const { cosmeticFilters } = parseFilters(raw, {
    loadCosmeticFilters: true,
    loadNetworkFilters: false,
    debug: true, // trengs for at rawLine (domenedelen) skal være tilgjengelig
  });

  const genericByStyle = new Map(); // style -> Set(selector)
  const genericUnhide = new Set(); // selektorer som er unntatt globalt
  const specific = []; // { s, h, not, style }

  for (const c of cosmeticFilters) {
    // Hopp over scriptlet-injeksjon og HTML-filtrering — vi gjør kun CSS-skjuling.
    if (c.isScriptInject() || c.isHtmlFiltering?.()) continue;
    if (!c.isCSS?.()) continue;

    const selector = c.getSelector();
    if (!selector) continue;
    // Hopp over ikke-native selektorer så de ikke ødelegger CSS-regelgruppene.
    if (NON_NATIVE_SELECTOR.test(selector)) continue;
    const style = c.getStyle('display: none !important');
    const { include, exclude } = c.rawLine ? parseDomainPart(c.rawLine) : { include: [], exclude: [] };

    if (c.isUnhide()) {
      // #@# unntak. For generiske unntak fjerner vi selektoren fra generisk sett.
      if (include.length === 0) genericUnhide.add(selector);
      continue;
    }

    if (c.isGenericHide() && include.length === 0) {
      if (!genericByStyle.has(style)) genericByStyle.set(style, new Set());
      genericByStyle.get(style).add(selector);
    } else if (include.length > 0) {
      specific.push({ s: selector, h: include, not: exclude, style });
    }
  }

  // Bygg generic-hide.css (fjern globalt unntatte selektorer).
  let css = '/* Generert av build-filters.mjs — ikke rediger for hånd. */\n';
  let genericCount = 0;
  for (const [style, selectors] of genericByStyle) {
    const list = [...selectors].filter((s) => !genericUnhide.has(s));
    genericCount += list.length;
    // Del opp i grupper for å unngå ekstremt lange selektorlinjer.
    const CHUNK = 500;
    for (let i = 0; i < list.length; i += CHUNK) {
      css += `${list.slice(i, i + CHUNK).join(',\n')} { ${style} }\n`;
    }
  }
  fs.writeFileSync(path.join(RULES_DIR, 'generic-hide.css'), css);

  // #6: Indekser sidespesifikke regler etter domenenøkkel (siste to labels) slik at
  // content-scriptet bare slår opp sitt eget domene i stedet for å skanne alle 11k.
  const { rules, index } = indexSpecificRules(specific);
  fs.writeFileSync(
    path.join(RULES_DIR, 'specific-hide.json'),
    JSON.stringify({ v: SPECIFIC_SCHEMA, rules, index }),
  );

  const genKB = Math.round(fs.statSync(path.join(RULES_DIR, 'generic-hide.css')).size / 1024);
  const specKB = Math.round(fs.statSync(path.join(RULES_DIR, 'specific-hide.json')).size / 1024);
  console.log(`  generic-hide.css    ${genericCount} selektorer  (${genKB} KB)`);
  console.log(`  specific-hide.json  ${rules.length} regler i ${Object.keys(index).length} domene-bøtter  (${specKB} KB)`);
}

async function main() {
  ensureDir(RULES_DIR);
  buildNetworkRulesets();
  await buildCosmetic();
  console.log('✓ Ferdig. Regelfiler skrevet til rules/.');
}

main().catch((err) => {
  console.error('✗ Build feilet:', err);
  process.exit(1);
});
