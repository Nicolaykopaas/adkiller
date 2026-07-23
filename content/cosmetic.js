/**
 * Kosmetisk skjuling: injiserer CSS for å skjule annonseelementer som ikke fanges
 * av nettverksblokkeringen.
 *
 *  #6  Bruker domene-indeksert specific-hide.json (slår opp kun eget domene).
 *  #7  Kjører i toppdokument OG same-origin subframes (ikke tunge cross-origin ad-frames).
 *  #9  Foretrekker oppdaterte lister fra chrome.storage (in-browser autooppdatering).
 *  #10 Anvender brukerens egne blokkeringsregler (element-plukker).
 */
(async () => {
  if (!document.documentElement) return;

  // #7: kjør i topp eller i subframe som deler origin med toppen. Cross-origin
  // ad-iframes håndteres av nettverksblokkeringen — vi injiserer ikke tung CSS der.
  function inScope() {
    if (window.top === window) return true;
    try {
      void window.top.location.href; // kaster ved cross-origin
      return true;
    } catch {
      return false;
    }
  }
  // scoped = toppframe eller same-origin subframe (der de tunge, domene-spesifikke
  // reglene er relevante). Generiske regler kjører i ALLE frames — også kryssorigin —
  // for å fange annonser inne i innebygde spillere (f.eks. piratsiders video-iframe).
  const scoped = inScope();

  const config = await chrome.runtime.sendMessage({ type: 'getContentConfig' }).catch(() => null);
  if (!config || !config.active) return;

  const isTop = window.top === window;
  const hostname = location.hostname.toLowerCase().replace(/^www\./, '');

  // ---- domene-hjelpere (speiler build-filters.mjs) ----
  function domainKey(host) {
    if (!host || host.includes('*')) return '*';
    const labels = host.split('.').filter(Boolean);
    return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
  }
  const hostCandidates = (() => {
    const set = new Set([hostname]);
    const labels = hostname.split('.');
    for (let i = 1; i < labels.length - 1; i++) set.add(labels.slice(i).join('.'));
    return set;
  })();
  function hostMatches(host) {
    return hostCandidates.has(host) || hostname === host || hostname.endsWith('.' + host);
  }

  function injectStyle(id, cssText) {
    if (!cssText) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  const url = (p) => chrome.runtime.getURL(p);
  async function fetchText(p) {
    return (await fetch(url(p))).text();
  }
  async function fetchJson(p) {
    return (await fetch(url(p))).json();
  }

  // ---- last inn lister: foretrekk oppdatert versjon fra storage (kun i toppframe) ----
  let stored = {};
  if (isTop) {
    stored = await chrome.storage.local
      .get(['cosmetic_generic', 'cosmetic_specific'])
      .catch(() => ({}));
  }

  // Tellere for diagnostikk-panelet.
  let genericApplied = false;
  let specificCount = 0;

  // 1) Generiske skjuleregler
  try {
    const generic = stored.cosmetic_generic || (await fetchText('rules/generic-hide.css'));
    injectStyle('best-adblock-generic', generic);
    genericApplied = !!generic;
  } catch (err) {
    console.debug('[best-adblock] generic-hide feilet', err);
  }

  // 2) + 3) kjører kun i toppframe/same-origin — domene-spesifikke regler og egne
  // regler er knyttet til toppsidens domene og gir ikke mening i kryssorigin-iframes.
  if (!scoped) {
    // Kryssorigin subframe: kun generisk skjuling, ferdig.
    return;
  }

  // 2) Domene-spesifikke regler (indeksert)
  try {
    const data = stored.cosmetic_specific || (await fetchJson('rules/specific-hide.json'));
    if (data && data.v === 2 && Array.isArray(data.rules)) {
      const keys = new Set([domainKey(hostname), '*']);
      const seen = new Set();
      const byStyle = new Map();
      for (const key of keys) {
        const bucket = data.index[key];
        if (!bucket) continue;
        for (const i of bucket) {
          if (seen.has(i)) continue;
          seen.add(i);
          const rule = data.rules[i];
          if (!rule.h.some(hostMatches)) continue;
          if (rule.not && rule.not.some(hostMatches)) continue;
          const style = rule.style || 'display: none !important';
          if (!byStyle.has(style)) byStyle.set(style, []);
          byStyle.get(style).push(rule.s);
          specificCount++;
        }
      }
      let css = '';
      for (const [style, selectors] of byStyle) css += `${selectors.join(',\n')} { ${style} }\n`;
      injectStyle('best-adblock-specific', css);
    }
  } catch (err) {
    console.debug('[best-adblock] specific-hide feilet', err);
  }

  // 3) #10 Brukerens egne regler for dette domenet
  let userCount = 0;
  try {
    const { userRules } = await chrome.storage.local.get('userRules');
    if (userRules) {
      const selectors = [];
      for (const [domain, sels] of Object.entries(userRules)) {
        if (hostMatches(domain)) selectors.push(...sels);
      }
      userCount = selectors.length;
      if (selectors.length) {
        injectStyle('best-adblock-user', `${selectors.join(',\n')} { display: none !important }`);
      }
    }
  } catch (err) {
    console.debug('[best-adblock] user-rules feilet', err);
  }

  // Meld inn til diagnostikk-panelet hva vi faktisk gjorde på denne siden.
  if (isTop) {
    chrome.runtime
      .sendMessage({
        type: 'reportDiag',
        cosmetic: { specific: specificCount, generic: genericApplied, user: userCount },
      })
      .catch(() => {});
  }
})();
