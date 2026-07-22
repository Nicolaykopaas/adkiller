/**
 * YouTube-annonseblokkering (eksperimentell, av som standard).
 *
 * YouTube-annonser sendes fra samme server som videoen. Ren JSON-pruning er ikke nok
 * lenger, og å røre videostrømmen knekker avspilling. Derfor to lag, slik de enkle
 * «AdBlock for YouTube»-utvidelsene gjør det:
 *
 *   LAG 1 — hopp forbi annonser i selve spilleren:
 *     Når spilleren har klassen `.ad-showing`, spol annonse-videoen til slutten og
 *     trykk «Hopp over». Rører ALDRI den ekte videoen, så avspilling kan ikke knekke.
 *
 *   LAG 2 — fjern annonseplanlegging fra player-JSON (best effort, forsiktig):
 *     Fjern kun annonsefelt, kun på objekter som faktisk er en player response.
 *     streamingData/videoDetails/playabilityStatus røres aldri.
 *
 * Registreres dynamisk av service workeren KUN når brukeren har skrudd på funksjonen.
 */
(() => {
  if (window.__bestAdblockYtLoaded) return;
  window.__bestAdblockYtLoaded = true;

  // ---------- LAG 1: hopp over annonser i spilleren ----------

  function skipVideoAd() {
    const player = document.getElementById('movie_player');
    const showingAd = player && player.classList.contains('ad-showing');

    if (showingAd) {
      const video = document.querySelector('.html5-main-video, video');
      if (video && isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        // Spol til slutten av annonse-strømmen — YouTube går da videre til innholdet.
        try {
          video.currentTime = video.duration;
        } catch { /* ignorer */ }
      }
    }

    // Trykk «Hopp over»-knappen så snart den finnes (alle kjente varianter).
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, ' +
        '.ytp-ad-skip-button-container button',
    );
    if (skip) skip.click();

    // Lukk overleggs-/banner-annonser.
    const overlayClose = document.querySelector(
      '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container',
    );
    if (overlayClose) overlayClose.click();
  }

  // Kjør jevnlig (annonser dukker opp når som helst i en video) + ved DOM-endringer.
  setInterval(skipVideoAd, 500);
  try {
    const obs = new MutationObserver(() => skipVideoAd());
    const start = () => {
      if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      else requestAnimationFrame(start);
    };
    start();
  } catch { /* ignorer */ }

  // ---------- LAG 1b: skjul statiske annonseflater ----------

  function injectCss() {
    if (document.getElementById('best-adblock-yt-css')) return;
    const style = document.createElement('style');
    style.id = 'best-adblock-yt-css';
    style.textContent = `
      #masthead-ad,
      ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-banner-promo-renderer,
      ytd-statement-banner-renderer,
      ytd-primetime-promo-renderer,
      #player-ads,
      #panels ytd-ads-engagement-panel-content-renderer,
      .ytp-ad-overlay-slot,
      .ytp-ad-overlay-container,
      .ytd-companion-slot-renderer,
      ytd-companion-slot-renderer {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  injectCss();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCss, { once: true });
  }

  // ---------- LAG 2: fjern annonseplanlegging fra player-JSON ----------

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const MAX_DEPTH = 8;

  function isPlayerResponse(o) {
    return !!(
      o &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      (o.streamingData || o.playabilityStatus || o.videoDetails || o.adPlacements || o.playerAds)
    );
  }

  function pruneAds(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return 0;
    let removed = 0;

    if (Array.isArray(node)) {
      for (const item of node) removed += pruneAds(item, depth + 1);
      return removed;
    }

    for (const key of AD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        try {
          delete node[key];
          removed++;
        } catch { /* ikke-slettbar */ }
      }
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (val && typeof val === 'object') removed += pruneAds(val, depth + 1);
    }
    return removed;
  }

  function tryPrune(data) {
    try {
      if (isPlayerResponse(data)) pruneAds(data);
    } catch { /* aldri ødelegg sidens egen parsing */ }
    return data;
  }

  try {
    const nativeParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      return tryPrune(nativeParse.call(this, text, reviver));
    };
  } catch { /* ignorer */ }

  try {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      return nativeJson.call(this).then(tryPrune);
    };
  } catch { /* ignorer */ }

  try {
    let stored;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(value) {
        stored = tryPrune(value);
      },
    });
  } catch { /* ignorer */ }
})();
