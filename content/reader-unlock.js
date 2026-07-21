/**
 * «Lås opp artikkel»-motor: fjerner MYKE lesevegger der innholdet allerede ligger i
 * DOM-en, men er gjemt bak et overlegg / scroll-lås / blur (registrer-deg-, nyhetsbrev-,
 * metered-gater osv.). Gjør IKKE noe med harde server-side paywalls (der teksten aldri
 * sendes til nettleseren) — det er hverken mulig eller ønskelig klient-side.
 *
 * Kjører som registrert content-script (document_idle, toppframe). Kjører automatisk
 * hvis auto-modus er på (globalt eller for denne siden), og alltid på forespørsel via
 * meldingen { type: 'runUnlock' } fra popup-en.
 */
(() => {
  if (window.__bestAdblockUnlockLoaded) return;
  window.__bestAdblockUnlockLoaded = true;

  const STYLE_ID = 'best-adblock-unlock-style';

  // Klasser som ofte låser scrolling på <html>/<body>.
  const LOCK_CLASSES = [
    'modal-open', 'no-scroll', 'noscroll', 'no_scroll', 'overflow-hidden',
    'is-locked', 'is-clipped', 'scroll-lock', 'scroll-locked', 'disable-scroll',
    'stop-scrolling', 'fixed', 'body-fixed', 'u-hidden', 'has-modal', 'menu-open',
    'mfp-zoom-out-cur', 'ReactModal__Body--open', 'tp-modal-open', 'gsc-modal-open',
  ];

  // Navn som tyder på lesevegg/overlegg (ikke ren cookie-funksjonalitet).
  const WALL_RE =
    /paywall|pay-wall|subscri|regi(?:ster|wall)|reg-?wall|sign[-_]?up|signin-wall|newsletter|metered|premium[-_]?wall|piano|tp-modal|tp-backdrop|leaky|barrier|gate(?:way|wall)?|fc-dialog|fc-consent|overlay|modal|backdrop|lightbox|interstitial|welcome-?ad|drawbridge|bx-|popup/i;

  // Navn vi ALDRI skjuler (ekte innhold).
  const CONTENT_RE = /article|main|content|story|post|page-body|entry/i;

  function forceStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      html, body {
        overflow: auto !important;
        overflow-y: auto !important;
        height: auto !important;
        min-height: 0 !important;
        position: static !important;
        pointer-events: auto !important;
        -webkit-user-select: auto !important;
        user-select: auto !important;
        filter: none !important;
      }
      /* fjern klipp/uttoning på tekstbeholdere */
      [style*="line-clamp"], [class*="clamp"] { -webkit-line-clamp: none !important; }
    `;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function restoreScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const cls of LOCK_CLASSES) el.classList.remove(cls);
      el.style.setProperty('overflow', 'auto', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('position', 'static', 'important');
      el.style.removeProperty('touch-action');
    }
  }

  function looksLikeContent(el) {
    if (el.matches?.('article, main, [role="main"], [itemprop="articleBody"]')) return true;
    if (el.querySelector?.('article, main, [itemprop="articleBody"]')) return true;
    // stor tekstmengde = sannsynlig artikkel, ikke et overlegg
    return (el.textContent || '').length > 3000;
  }

  function removeOverlays() {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    // Kandidater: elementer som typisk brukes til modaler/overlegg.
    const nodes = document.querySelectorAll(
      'body div, body section, body aside, body dialog, dialog, [class*="modal"], [class*="overlay"], [id*="modal"], [id*="paywall"]',
    );
    let removed = 0;
    for (const el of nodes) {
      if (el === document.body || el === document.documentElement) continue;
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fixedOrAbs = cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky';
      if (!fixedOrAbs) continue;

      const name = `${el.id} ${el.className}`;
      if (typeof el.className !== 'string') continue; // hopp over SVG o.l.
      if (CONTENT_RE.test(name) && !WALL_RE.test(name)) continue;
      if (looksLikeContent(el)) continue;

      const r = el.getBoundingClientRect();
      const coversMost = r.width >= vw * 0.85 && r.height >= vh * 0.55;
      const zi = parseInt(cs.zIndex, 10) || 0;
      const nameMatch = WALL_RE.test(name);

      // Skjul hvis: (dekker det meste med høy z / fixed) ELLER (matcher vegg-navn og flyter over).
      if ((coversMost && (zi >= 100 || cs.position === 'fixed')) || (nameMatch && (coversMost || zi >= 1000))) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-bestadblock-unlocked', '1');
        removed++;
      }
    }
    return removed;
  }

  function unblur() {
    // Nullstill inline blur-filtre og linje-klipp som brukes til å «teasere» tekst.
    for (const el of document.querySelectorAll('[style]')) {
      const s = el.getAttribute('style') || '';
      if (/blur\(|line-clamp|-webkit-line-clamp/i.test(s)) {
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        el.style.removeProperty('-webkit-line-clamp');
        if (/max-height/i.test(s)) el.style.setProperty('max-height', 'none', 'important');
      }
    }
  }

  let observer = null;
  function observeFor(ms) {
    if (observer) observer.disconnect();
    let scheduled = false;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        restoreScroll();
        removeOverlays();
      });
    });
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch { /* ignorer */ }
    setTimeout(() => observer && observer.disconnect(), ms);
  }

  function unlock() {
    forceStyle();
    restoreScroll();
    const removed = removeOverlays();
    unblur();
    observeFor(6000);
    console.debug('[best-adblock] lås opp: fjernet', removed, 'overlegg');
    return removed;
  }

  // På forespørsel fra popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'runUnlock') {
      const removed = unlock();
      sendResponse({ ok: true, removed });
    }
    return false;
  });

  // Auto-modus: spør bakgrunnen om vi skal kjøre automatisk her.
  chrome.runtime
    .sendMessage({ type: 'getContentConfig' })
    .then((config) => {
      if (config && config.enabled && (config.readerAuto || config.unlockThisSite)) {
        const run = () => unlock();
        if (document.readyState === 'complete') run();
        else window.addEventListener('load', run, { once: true });
      }
    })
    .catch(() => {});
})();
