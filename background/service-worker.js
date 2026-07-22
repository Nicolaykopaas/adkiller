/**
 * Bakgrunns-service-worker:
 *  - styrer av/på (aktiverer/deaktiverer DNR-regelsett)
 *  - håndterer whitelist per side (dynamiske "allow"-regler + signal til content scripts)
 *  - teller blokkerte forespørsler per fane og viser tallet på ikon-badgen
 */

const STATIC_RULESETS = ['ads', 'privacy', 'annoyances'];
const DEFAULT_RULESETS = { ads: true, privacy: true, annoyances: true };
const DEFAULT_STATE = {
  enabled: true,
  whitelist: [],
  rulesets: DEFAULT_RULESETS,
  readerAuto: true, // "lås opp artikkel" automatisk på alle sider (standard på)
  unlockSites: [], // eller kun for disse domenene
};

// Dynamiske regler starter på denne id-en (unngår kollisjon med statiske regelsett).
const DYNAMIC_RULE_BASE = 1_000_000;

// #3: onRuleMatchedDebug finnes KUN for utpakkede utvidelser -> pålitelig dev-signal
// uten ekstra permission. Brukes til å gate hot-reload og live badge-teller.
const IS_DEV = !!chrome.declarativeNetRequest.onRuleMatchedDebug;

// Per-fane teller for blokkerte forespørsler (nullstilles ved ny navigasjon).
const tabBlockCount = new Map();

// Per-fane diagnostikk: hva ble faktisk blokkert/skjult på denne siden.
// Uten dette er brukerrapporter som «virker ikke» umulige å feilsøke presist.
const tabDiag = new Map();

function freshDiag() {
  return {
    byRuleset: { ads: 0, privacy: 0, annoyances: 0, dynamic: 0 },
    cosmetic: { specific: 0, generic: false, user: 0 },
    unlock: { ran: false, removed: 0 },
  };
}

function getDiag(tabId) {
  if (!tabDiag.has(tabId)) tabDiag.set(tabId, freshDiag());
  return tabDiag.get(tabId);
}
// Tidspunkt for siste hovednavigasjon per fane (for badge-fallback via getMatchedRules).
const tabNavStart = new Map();

// ---------- tilstand ----------

async function getState() {
  const s = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    enabled: s.enabled !== false,
    whitelist: Array.isArray(s.whitelist) ? s.whitelist : [],
    rulesets: { ...DEFAULT_RULESETS, ...(s.rulesets || {}) },
    readerAuto: s.readerAuto !== false, // standard: på
    unlockSites: Array.isArray(s.unlockSites) ? s.unlockSites : [],
  };
}

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

// ---------- DNR-styring ----------

async function applyEnabledRulesets(enabled, rulesets) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  for (const id of STATIC_RULESETS) {
    if (enabled && rulesets[id] !== false) enableRulesetIds.push(id);
    else disableRulesetIds.push(id);
  }
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    });
  } catch (err) {
    console.error('Kunne ikke oppdatere regelsett:', err);
  }
  // #2: Verifiser at Chrome faktisk aktiverte det vi ba om. Overstiges den globale
  // regelgrensa (delt med andre DNR-utvidelser), deaktiverer Chrome regelsett stille.
  try {
    const active = await chrome.declarativeNetRequest.getEnabledRulesets();
    const missing = enableRulesetIds.filter((id) => !active.includes(id));
    if (missing.length) {
      let avail = 'ukjent';
      try {
        avail = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
      } catch { /* ignorer */ }
      console.warn(
        `⚠ Regelsett ikke aktivert: ${missing.join(', ')}. Sannsynligvis Chromes ` +
          `globale statiske regelgrense (ledig antall: ${avail}). ` +
          'Skru av en filterkategori i Innstillinger, eller deaktiver andre adblockere.',
      );
      await chrome.storage.local.set({ rulesetsMissing: missing });
    } else {
      await chrome.storage.local.remove('rulesetsMissing');
    }
  } catch { /* getEnabledRulesets kan feile tidlig i oppstart */ }
}

/** Synk dynamiske "allow"-regler slik at whitelistede domener slipper blokkering. */
async function applyWhitelistRules(whitelist) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules = whitelist.map((host, i) => ({
    id: DYNAMIC_RULE_BASE + i,
    priority: 100000,
    action: { type: 'allowAllRequests' },
    condition: {
      requestDomains: [host],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function syncEverything() {
  const { enabled, whitelist, rulesets } = await getState();
  await applyEnabledRulesets(enabled, rulesets);
  await applyWhitelistRules(enabled ? whitelist : []);
  await refreshAllBadges();
}

// ---------- badge ----------

async function setBadge(tabId, count) {
  const text = count > 0 ? (count > 999 ? '999+' : String(count)) : '';
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d33682' });
  } catch {
    /* fanen finnes kanskje ikke lenger */
  }
}

async function refreshAllBadges() {
  const { enabled } = await getState();
  if (!enabled) {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// Live teller i dev via onRuleMatchedDebug (kun utpakkede utvidelser).
if (IS_DEV) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request.tabId;
    if (tabId < 0) return;
    const next = (tabBlockCount.get(tabId) || 0) + 1;
    tabBlockCount.set(tabId, next);
    setBadge(tabId, next);

    // Fordel treffet på kategori, så diagnostikk-panelet kan vise hva som skjer.
    const diag = getDiag(tabId);
    const rs = info.rule?.rulesetId;
    if (rs && Object.prototype.hasOwnProperty.call(diag.byRuleset, rs)) diag.byRuleset[rs]++;
    else diag.byRuleset.dynamic++;
  });
}

// #8: Fallback som virker i pakkede utvidelser — tell treff via getMatchedRules
// (krever declarativeNetRequestFeedback, som vi har). Oppdateres etter navigasjon.
async function badgeFromMatched(tabId) {
  if (IS_DEV || tabId == null || tabId < 0) return;
  try {
    const since = tabNavStart.get(tabId) || 0;
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({
      tabId,
      minTimeStamp: since,
    });
    const count = rulesMatchedInfo.length;
    tabBlockCount.set(tabId, count);
    setBadge(tabId, count);
  } catch { /* API kan være utilgjengelig */ }
}

// Nullstill teller ved ny hovednavigasjon.
chrome.webNavigation?.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  tabNavStart.set(details.tabId, Date.now());
  tabBlockCount.set(details.tabId, 0);
  tabDiag.set(details.tabId, freshDiag());
  setBadge(details.tabId, 0);
});

// Oppdater badge når siden er ferdig lastet (fallback-modus).
chrome.webNavigation?.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  badgeFromMatched(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockCount.delete(tabId);
  tabNavStart.delete(tabId);
  tabDiag.delete(tabId);
});

/**
 * Helsesjekk: har Chrome faktisk aktivert regelsettene vi ba om?
 * Med ~173k statiske regler kan Chrome stille deaktivere regelsett når den globale
 * regelpuljen er brukt opp (f.eks. hvis en annen DNR-utvidelse er installert).
 * Uten denne sjekken svikter blokkeringen uten noe synlig varsel.
 */
async function rulesetHealth() {
  const { enabled, rulesets } = await getState();
  const intended = enabled ? STATIC_RULESETS.filter((id) => rulesets[id] !== false) : [];
  let active = [];
  try {
    active = await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch { /* kan feile tidlig i oppstart */ }
  return { intended, active, missing: intended.filter((id) => !active.includes(id)) };
}

// ---------- meldinger fra popup / content ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'getPopupState': {
        const { enabled, whitelist, readerAuto, unlockSites } = await getState();
        const tab = msg.tabId
          ? await chrome.tabs.get(msg.tabId).catch(() => null)
          : null;
        let host = '';
        try {
          host = tab?.url ? normalizeHost(new URL(tab.url).hostname) : '';
        } catch {
          host = '';
        }
        if (msg.tabId) await badgeFromMatched(msg.tabId); // oppdater teller i fallback-modus
        sendResponse({
          enabled,
          host,
          whitelisted: host ? whitelist.includes(host) : false,
          blocked: msg.tabId ? tabBlockCount.get(msg.tabId) || 0 : 0,
          readerAuto,
          unlockThisSite: host ? unlockSites.includes(host) : false,
        });
        return;
      }

      case 'setEnabled': {
        await chrome.storage.local.set({ enabled: !!msg.value });
        await syncEverything();
        sendResponse({ ok: true });
        return;
      }

      case 'toggleWhitelist': {
        const host = normalizeHost(msg.host);
        if (!host) {
          sendResponse({ ok: false });
          return;
        }
        const { whitelist } = await getState();
        const set = new Set(whitelist);
        if (set.has(host)) set.delete(host);
        else set.add(host);
        await chrome.storage.local.set({ whitelist: [...set] });
        await syncEverything();
        sendResponse({ ok: true, whitelisted: set.has(host) });
        return;
      }

      case 'getOptions': {
        const { enabled, whitelist, rulesets, readerAuto, unlockSites } = await getState();
        sendResponse({ enabled, whitelist, rulesets, readerAuto, unlockSites });
        return;
      }

      case 'setRuleset': {
        const { rulesets } = await getState();
        rulesets[msg.id] = !!msg.value;
        await chrome.storage.local.set({ rulesets });
        await syncEverything();
        sendResponse({ ok: true });
        return;
      }

      case 'removeWhitelist': {
        const host = normalizeHost(msg.host);
        const { whitelist } = await getState();
        await chrome.storage.local.set({ whitelist: whitelist.filter((h) => h !== host) });
        await syncEverything();
        sendResponse({ ok: true });
        return;
      }

      case 'getContentConfig': {
        // Content-scriptet spør om det skal kjøre kosmetisk skjuling / popup-blokkering / unlock.
        const { enabled, whitelist, readerAuto, unlockSites } = await getState();
        let host = '';
        try {
          host = normalizeHost(new URL(sender.tab?.url || sender.url || '').hostname);
        } catch {
          host = '';
        }
        const whitelisted = host ? whitelist.includes(host) : false;
        sendResponse({
          enabled, // popup-blokkering følger av/på-bryteren
          active: enabled && !whitelisted, // kosmetisk skjuling respekterer også whitelist
          readerAuto, // auto "lås opp artikkel" globalt
          unlockThisSite: host ? unlockSites.includes(host) : false,
        });
        return;
      }

      // ---- diagnostikk ----
      case 'reportDiag': {
        // Content-scripts melder hva de faktisk gjorde på denne siden.
        const tabId = sender.tab?.id;
        if (tabId != null && tabId >= 0) {
          const diag = getDiag(tabId);
          if (msg.cosmetic) Object.assign(diag.cosmetic, msg.cosmetic);
          if (msg.unlock) Object.assign(diag.unlock, msg.unlock);
        }
        sendResponse({ ok: true });
        return;
      }

      case 'getDiagnostics': {
        const tabId = msg.tabId;
        if (tabId != null) await badgeFromMatched(tabId); // frisk opp i fallback-modus
        const diag = tabId != null ? getDiag(tabId) : freshDiag();
        const b = diag.byRuleset;
        sendResponse({
          blocked: {
            total: tabId != null ? tabBlockCount.get(tabId) || 0 : 0,
            ads: b.ads,
            privacy: b.privacy,
            annoyances: b.annoyances,
            dynamic: b.dynamic,
          },
          cosmetic: diag.cosmetic,
          unlock: diag.unlock,
          rulesets: await rulesetHealth(),
          precise: IS_DEV, // kun i dev har vi eksakt per-kategori-telling
        });
        return;
      }

      /**
       * «Noe er feil»: lager en feilrapport for aktiv side og whitelister den med
       * én gang, slik at brukeren kommer videre mens feilen undersøkes.
       * Rapporten er ren tekst laget for å limes rett inn i en samtale.
       */
      case 'reportProblem': {
        const tabId = msg.tabId;
        const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
        if (!tab || !/^https?:/.test(tab.url || '')) {
          sendResponse({ ok: false });
          return;
        }

        let host = '';
        try {
          host = normalizeHost(new URL(tab.url).hostname);
        } catch {
          sendResponse({ ok: false });
          return;
        }

        // Whitelist siden så den virker med en gang.
        const { whitelist, enabled, readerAuto, unlockSites } = await getState();
        const set = new Set(whitelist);
        set.add(host);
        await chrome.storage.local.set({ whitelist: [...set] });
        await syncEverything();

        await badgeFromMatched(tabId);
        const diag = getDiag(tabId);
        const health = await rulesetHealth();
        const manifest = chrome.runtime.getManifest();

        const lines = [
          'BEST ADBLOCK — FEILRAPPORT',
          `URL:        ${tab.url}`,
          `Domene:     ${host}`,
          `Tidspunkt:  ${new Date().toISOString()}`,
          `Versjon:    ${manifest.version} (${IS_DEV ? 'utpakket/dev' : 'pakket'})`,
          '',
          `Blokkert:   ${tabBlockCount.get(tabId) || 0} forespørsler ` +
            `(annonser ${diag.byRuleset.ads}, sporing ${diag.byRuleset.privacy}, ` +
            `irritasjoner ${diag.byRuleset.annoyances}, dynamisk ${diag.byRuleset.dynamic})`,
          `Kosmetisk:  ${diag.cosmetic.specific} regler, generisk ${diag.cosmetic.generic ? 'på' : 'AV'}, ` +
            `${diag.cosmetic.user} egne`,
          `Lås opp:    ${diag.unlock.ran ? `kjørte, fjernet ${diag.unlock.removed}` : 'ikke utløst'}`,
          '',
          `Utvidelse:  ${enabled ? 'på' : 'AV'}`,
          `Regelsett:  aktive [${health.active.join(', ') || 'ingen'}]` +
            (health.missing.length ? `  ⚠ MANGLER [${health.missing.join(', ')}]` : ''),
          `Auto-unlock: ${readerAuto ? 'på' : 'av'}` +
            (unlockSites.includes(host) ? ' (+ alltid på denne siden)' : ''),
          '',
          `Siden er nå whitelistet. Beskriv hva som var galt:`,
        ];
        const text = lines.join('\n');

        // Behold de siste 20 rapportene så de kan hentes fram senere.
        const { problemReports } = await chrome.storage.local.get('problemReports');
        const reports = Array.isArray(problemReports) ? problemReports : [];
        reports.unshift({ host, url: tab.url, at: Date.now(), text });
        await chrome.storage.local.set({ problemReports: reports.slice(0, 20) });

        sendResponse({ ok: true, text, host, whitelisted: true });
        return;
      }

      // ---- "Lås opp artikkel" ----
      case 'runUnlock': {
        const tabId = msg.tabId;
        if (!tabId) {
          sendResponse({ ok: false });
          return;
        }
        try {
          const res = await chrome.tabs.sendMessage(tabId, { type: 'runUnlock' });
          sendResponse(res || { ok: true });
        } catch {
          // Content-scriptet er kanskje ikke lastet (f.eks. rett etter install) — injiser og prøv igjen.
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content/reader-unlock.js'] });
            const res = await chrome.tabs.sendMessage(tabId, { type: 'runUnlock' });
            sendResponse(res || { ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err) });
          }
        }
        return;
      }
      case 'setReaderAuto': {
        await chrome.storage.local.set({ readerAuto: !!msg.value });
        sendResponse({ ok: true });
        return;
      }
      case 'toggleUnlockSite': {
        const host = normalizeHost(msg.host);
        if (!host) {
          sendResponse({ ok: false });
          return;
        }
        const { unlockSites } = await getState();
        const set = new Set(unlockSites);
        if (set.has(host)) set.delete(host);
        else set.add(host);
        await chrome.storage.local.set({ unlockSites: [...set] });
        sendResponse({ ok: true, active: set.has(host) });
        return;
      }
      case 'removeUnlockSite': {
        const host = normalizeHost(msg.host);
        const { unlockSites } = await getState();
        await chrome.storage.local.set({ unlockSites: unlockSites.filter((h) => h !== host) });
        sendResponse({ ok: true });
        return;
      }

      // #9: manuell oppdatering av kosmetiske lister
      case 'updateCosmeticNow': {
        const res = await updateCosmetic();
        sendResponse(res);
        return;
      }
      case 'getCosmeticInfo': {
        const { cosmetic_updated } = await chrome.storage.local.get('cosmetic_updated');
        sendResponse({ updated: cosmetic_updated || null });
        return;
      }

      // #10: element-plukker og egne regler
      case 'startPicker': {
        const tabId = msg.tabId;
        if (!tabId) {
          sendResponse({ ok: false });
          return;
        }
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/element-picker.js'],
          });
          sendResponse({ ok: true });
        } catch (err) {
          console.error('Kunne ikke starte plukker:', err);
          sendResponse({ ok: false, error: String(err) });
        }
        return;
      }
      case 'addUserRule': {
        const host = normalizeHost(msg.host || (sender.tab?.url ? new URL(sender.tab.url).hostname : ''));
        const selector = String(msg.selector || '').trim();
        if (!host || !selector) {
          sendResponse({ ok: false });
          return;
        }
        const { userRules = {} } = await chrome.storage.local.get('userRules');
        const list = new Set(userRules[host] || []);
        list.add(selector);
        userRules[host] = [...list];
        await chrome.storage.local.set({ userRules });
        sendResponse({ ok: true });
        return;
      }
      case 'getUserRules': {
        const { userRules = {} } = await chrome.storage.local.get('userRules');
        sendResponse({ userRules });
        return;
      }
      case 'removeUserRule': {
        const host = normalizeHost(msg.host);
        const { userRules = {} } = await chrome.storage.local.get('userRules');
        if (userRules[host]) {
          userRules[host] = userRules[host].filter((s) => s !== msg.selector);
          if (!userRules[host].length) delete userRules[host];
          await chrome.storage.local.set({ userRules });
        }
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, error: 'ukjent melding' });
    }
  })();
  return true; // async svar
});

// ---------- #9: in-browser oppdatering av kosmetiske lister ----------
// Nettverksreglene (DNR) er statiske og krever rebuild, men de kosmetiske reglene
// (som forfaller raskest, f.eks. VG) kan oppdateres i nettleseren. Vi henter listene,
// parser element-hiding-reglene og lagrer dem i storage — cosmetic.js foretrekker disse.

const COSMETIC_LIST_URLS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/DandelionSprout/adfilt/master/NorwegianList.txt',
  'https://raw.githubusercontent.com/liamengland1/miscfilters/master/antipaywall.txt',
];
const COSMETIC_ALARM = 'best-adblock-cosmetic-update';
const NON_NATIVE_SELECTOR =
  /:(?:-abp-|contains|has-text|matches-css|matches-media|matches-path|matches-property|xpath|upward|nth-ancestor|min-text-length|watch-attr|remove|if|if-not)\b|:style\(/i;

function cosmeticDomainKey(host) {
  if (!host || host.includes('*')) return '*';
  const labels = host.split('.').filter(Boolean);
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
}

/** Minimal ABP-parser for element-hiding-regler (kun CSS-skjuling, ingen scriptlets). */
function parseCosmeticLists(raw) {
  const genericSet = new Set();
  const genericUnhide = new Set();
  const specific = [];

  for (let line of raw.split('\n')) {
    line = line.trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;

    let sep;
    let sepLen;
    let unhide = false;
    const uh = line.indexOf('#@#');
    if (uh >= 0) {
      sep = uh;
      sepLen = 3;
      unhide = true;
    } else {
      const h = line.indexOf('##');
      if (h < 0) continue; // ikke element-hiding (skipper #?# #$# #%# nettverk osv.)
      sep = h;
      sepLen = 2;
    }

    const selector = line.slice(sep + sepLen).trim();
    if (!selector || selector.startsWith('+js') || NON_NATIVE_SELECTOR.test(selector)) continue;

    const include = [];
    const exclude = [];
    const domainPart = line.slice(0, sep);
    if (domainPart) {
      for (const p of domainPart.split(',')) {
        const d = p.trim();
        if (!d) continue;
        if (d.startsWith('~')) exclude.push(d.slice(1).toLowerCase());
        else include.push(d.toLowerCase());
      }
    }

    if (unhide) {
      if (include.length === 0) genericUnhide.add(selector);
      continue;
    }
    if (include.length === 0) genericSet.add(selector);
    else specific.push({ s: selector, h: include, not: exclude });
  }

  const genericList = [...genericSet].filter((s) => !genericUnhide.has(s));
  let css = '/* Auto-oppdatert av utvidelsen. */\n';
  for (let i = 0; i < genericList.length; i += 500) {
    css += genericList.slice(i, i + 500).join(',\n') + ' { display: none !important }\n';
  }

  const rules = [];
  const index = Object.create(null);
  for (const r of specific) {
    const rule = { s: r.s, h: r.h };
    if (r.not.length) rule.not = r.not;
    const i = rules.push(rule) - 1;
    for (const key of new Set(r.h.map(cosmeticDomainKey))) {
      (index[key] || (index[key] = [])).push(i);
    }
  }

  return { generic: css, specific: { v: 2, rules, index }, genericCount: genericList.length, specificCount: rules.length };
}

async function updateCosmetic() {
  try {
    let raw = '';
    for (const url of COSMETIC_LIST_URLS) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      raw += '\n' + (await res.text());
    }
    const parsed = parseCosmeticLists(raw);
    const updated = Date.now();
    await chrome.storage.local.set({
      cosmetic_generic: parsed.generic,
      cosmetic_specific: parsed.specific,
      cosmetic_updated: updated,
    });
    console.log(`Kosmetiske lister oppdatert: ${parsed.genericCount} generiske, ${parsed.specificCount} spesifikke`);
    return { ok: true, updated, generic: parsed.genericCount, specific: parsed.specificCount };
  } catch (err) {
    console.error('Oppdatering av kosmetiske lister feilet:', err);
    return { ok: false, error: String(err) };
  }
}

function setupCosmeticUpdater() {
  chrome.alarms.create(COSMETIC_ALARM, { periodInMinutes: 60 * 24 * 7 }); // ukentlig
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === COSMETIC_ALARM) updateCosmetic();
});

// ---------- hot-reload (kun dev) ----------
// Poller version.json; når den endres (bumpet av build/watch), lastes utvidelsen på
// nytt og aktiv fane oppdateres. #3: kjører KUN i utpakket (dev) modus, så en
// publisert utvidelse aldri self-reloader hos sluttbrukere.

const DEV_HOT_RELOAD = IS_DEV;
const HOT_ALARM = 'best-adblock-hot-reload';

async function readBuildVersion() {
  try {
    const res = await fetch(chrome.runtime.getURL('version.json'), { cache: 'no-store' });
    const json = await res.json();
    return json.build;
  } catch {
    return null;
  }
}

async function checkForReload() {
  if (!DEV_HOT_RELOAD) return;
  const current = await readBuildVersion();
  if (current == null) return;
  const { hotBuild } = await chrome.storage.local.get('hotBuild');
  if (hotBuild == null) {
    await chrome.storage.local.set({ hotBuild: current });
    return;
  }
  if (current !== hotBuild) {
    // Lagre ny versjon FØR reload for å unngå reload-løkke.
    await chrome.storage.local.set({ hotBuild: current });
    chrome.runtime.reload();
  }
}

/**
 * VIKTIG: hot-reload skal ALDRI laste brukerens faner på nytt.
 * Tidligere refreshet vi aktiv fane etter en reload — det kastet brukeren ut av
 * videoer midt i avspilling hver gang en ny build ble bygget. Nye content-scripts
 * trer i kraft ved neste naturlige sidelasting; det er godt nok.
 */
async function afterReloadRefresh() {
  await chrome.storage.local.remove('hotReloadRefresh'); // rydd bort gammelt flagg
}

function setupHotReload() {
  if (!DEV_HOT_RELOAD) return;
  chrome.alarms.create(HOT_ALARM, { periodInMinutes: 0.5 });
}

if (DEV_HOT_RELOAD) {
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === HOT_ALARM) checkForReload();
  });
  // Sjekk også når service workeren våkner av andre grunner (føles raskere).
  chrome.tabs.onActivated.addListener(() => checkForReload());
}

// ---------- oppstart ----------

async function boot() {
  await afterReloadRefresh();
  await syncEverything();
  setupCosmeticUpdater();
  setupHotReload();
  await checkForReload();
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
// Kjør også ved kald oppstart av service workeren.
boot();
