/**
 * «Lås opp artikkel»-motor: fjerner MYKE lesevegger der innholdet allerede ligger i
 * DOM-en, men er gjemt bak et overlegg / scroll-lås / blur (registrer-deg-, nyhetsbrev-,
 * metered-gater osv.). Gjør IKKE noe med harde server-side paywalls (der teksten aldri
 * sendes til nettleseren) — det er hverken mulig eller ønskelig klient-side.
 *
 * VIKTIG: i auto-modus gjør motoren INGENTING med mindre den faktisk oppdager en vegg.
 * Uten den gaten ødela den app-sider (Facebook m.fl.) ved å tvinge om scroll-stilene.
 * Manuell kjøring (knappen i popup) er aggressiv, fordi brukeren da ber om det eksplisitt.
 */
(() => {
  if (window.__bestAdblockUnlockLoaded) return;
  window.__bestAdblockUnlockLoaded = true;

  const STYLE_ID = 'best-adblock-unlock-style';

  // App-sider (ikke artikkelsider) hvor auto-modus aldri skal røre noe.
  const APP_HOSTS = [
    'facebook.com', 'messenger.com', 'instagram.com', 'threads.net', 'whatsapp.com',
    'x.com', 'twitter.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'snapchat.com',
    'youtube.com', 'twitch.tv', 'netflix.com', 'spotify.com', 'soundcloud.com',
    'google.com', 'gmail.com', 'googledocs.com', 'outlook.com', 'live.com',
    'office.com', 'microsoft.com', 'teams.microsoft.com', 'slack.com', 'discord.com',
    'github.com', 'gitlab.com', 'figma.com', 'notion.so', 'trello.com', 'atlassian.net',
    'amazon.com', 'ebay.com', 'finn.no', 'vipps.no', 'bankid.no', 'nav.no', 'altinn.no',
  ];

  // Klasser som ofte låser scrolling på <html>/<body>.
  const LOCK_CLASSES = [
    'modal-open', 'no-scroll', 'noscroll', 'no_scroll', 'overflow-hidden',
    'is-locked', 'is-clipped', 'scroll-lock', 'scroll-locked', 'disable-scroll',
    'stop-scrolling', 'body-fixed', 'has-modal', 'menu-open',
    'mfp-zoom-out-cur', 'ReactModal__Body--open', 'tp-modal-open', 'gsc-modal-open',
  ];

  // Navn som tyder på lesevegg/overlegg.
  const WALL_RE =
    /paywall|pay-wall|subscri|regi(?:ster|wall)|reg-?wall|sign[-_]?up|signin-wall|newsletter|metered|premium[-_]?wall|piano|tp-modal|tp-backdrop|leaky|barrier|gate(?:way|wall)|fc-dialog|interstitial|welcome-?ad|drawbridge/i;

  // Litt bredere sett for aggressiv (manuell) modus.
  const WALL_RE_LOOSE = new RegExp(`${WALL_RE.source}|overlay|modal|backdrop|lightbox|popup`, 'i');

  // Navn vi ALDRI skjuler (ekte innhold).
  const CONTENT_RE = /article|main|content|story|post|page-body|entry|feed|timeline/i;

  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const isAppHost = APP_HOSTS.some((h) => host === h || host.endsWith('.' + h));

  // ---------- deteksjon ----------

  /** Er scrolling faktisk låst? (innhold høyere enn vinduet + overflow hidden/fixed body) */
  function scrollLocked() {
    const de = document.documentElement;
    const b = document.body;
    if (!de || !b) return false;
    const tall = Math.max(de.scrollHeight, b.scrollHeight) > window.innerHeight + 100;
    if (!tall) return false;
    for (const el of [de, b]) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (/hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY)) return true;
      if (cs.position === 'fixed') return true;
    }
    return false;
  }

  /** Finnes et overlegg som ser ut som en lesevegg (navn-match, ikke bare "stort")? */
  function wallOverlayExists() {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    for (const el of document.querySelectorAll('div,section,aside,dialog')) {
      if (typeof el.className !== 'string') continue;
      const name = `${el.id} ${el.className}`;
      if (!WALL_RE.test(name)) continue;
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.5 && r.height >= vh * 0.3) return true;
    }
    return false;
  }

  function detectWall() {
    return scrollLocked() || wallOverlayExists();
  }

  // ---------- tiltak ----------

  function forceStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html, body {
        overflow: auto !important;
        overflow-y: auto !important;
        height: auto !important;
        min-height: 0 !important;
        pointer-events: auto !important;
        -webkit-user-select: auto !important;
        user-select: auto !important;
        filter: none !important;
      }
      [style*="line-clamp"], [class*="clamp"] { -webkit-line-clamp: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function restoreScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const cls of LOCK_CLASSES) el.classList.remove(cls);
      el.style.setProperty('overflow', 'auto', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('height', 'auto', 'important');
      // position:static kun når siden faktisk bruker fixed-body-triksed for å låse scroll.
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        cs = null;
      }
      if (cs && cs.position === 'fixed') {
        el.style.setProperty('position', 'static', 'important');
        el.style.removeProperty('top');
      }
      el.style.removeProperty('touch-action');
    }
  }

  function looksLikeContent(el) {
    if (el.matches?.('article, main, [role="main"], [itemprop="articleBody"]')) return true;
    if (el.querySelector?.('article, main, [itemprop="articleBody"]')) return true;
    return (el.textContent || '').length > 3000;
  }

  function removeOverlays(aggressive) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const re = aggressive ? WALL_RE_LOOSE : WALL_RE;
    let removed = 0;
    for (const el of document.querySelectorAll('div,section,aside,dialog')) {
      if (el === document.body || el === document.documentElement) continue;
      if (typeof el.className !== 'string') continue;
      const name = `${el.id} ${el.className}`;
      const nameMatch = re.test(name);

      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (CONTENT_RE.test(name) && !nameMatch) continue;
      if (looksLikeContent(el)) continue;

      const r = el.getBoundingClientRect();
      const coversMost = r.width >= vw * 0.85 && r.height >= vh * 0.55;
      const zi = parseInt(cs.zIndex, 10) || 0;

      // Forsiktig modus krever navn-match. Aggressiv modus tillater rene "dekker alt"-overlegg.
      const hit = aggressive
        ? (nameMatch && (coversMost || zi >= 500)) || (coversMost && zi >= 100)
        : nameMatch && (coversMost || zi >= 500);

      if (hit) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-bestadblock-unlocked', '1');
        removed++;
      }
    }
    return removed;
  }

  function unblur() {
    for (const el of document.querySelectorAll('[style*="blur"], [style*="clamp"]')) {
      const s = el.getAttribute('style') || '';
      if (!/blur\(|line-clamp/i.test(s)) continue;
      el.style.setProperty('filter', 'none', 'important');
      el.style.setProperty('-webkit-filter', 'none', 'important');
      el.style.removeProperty('-webkit-line-clamp');
      if (/max-height/i.test(s)) el.style.setProperty('max-height', 'none', 'important');
    }
  }

  let observer = null;
  function observeFor(ms, aggressive) {
    if (observer) observer.disconnect();
    let scheduled = false;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        // Bare fortsett å rydde så lenge det faktisk finnes en vegg.
        if (aggressive || detectWall()) {
          restoreScroll();
          removeOverlays(aggressive);
        }
      });
    });
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    } catch { /* ignorer */ }
    setTimeout(() => observer && observer.disconnect(), ms);
  }

  /** aggressive=true ved manuell kjøring; auto-modus krever at en vegg faktisk finnes. */
  function unlock(aggressive) {
    if (!aggressive && !detectWall()) return 0;
    forceStyle();
    restoreScroll();
    const removed = removeOverlays(aggressive);
    unblur();
    observeFor(aggressive ? 6000 : 4000, aggressive);
    return removed;
  }

  // Manuell kjøring fra popup — aggressiv.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'runUnlock') {
      sendResponse({ ok: true, removed: unlock(true) });
    }
    return false;
  });

  // Auto-modus: kun på ikke-app-sider, og kun hvis en vegg faktisk oppdages.
  if (!isAppHost) {
    chrome.runtime
      .sendMessage({ type: 'getContentConfig' })
      .then((config) => {
        if (!config || !config.enabled) return;
        if (!config.readerAuto && !config.unlockThisSite) return;
        const run = () => {
          // Vent litt så sent-injiserte vegger rekker å dukke opp.
          unlock(false);
          setTimeout(() => unlock(false), 1200);
        };
        if (document.readyState === 'complete') run();
        else window.addEventListener('load', run, { once: true });
      })
      .catch(() => {});
  }
})();
