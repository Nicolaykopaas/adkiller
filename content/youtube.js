/**
 * YouTube-annonseblokkering (alltid på).
 *
 * NØKKELEN til å unngå ventetid: hindre at annonser i det hele tatt planlegges.
 * YouTube henter «player response» fra /youtubei/v1/player og planlegger annonser via
 * feltene adPlacements/playerAds der. Fjerner vi dem FØR spilleren leser svaret, laster
 * YouTube kun innholdsvideoen — ingen annonse, og dermed ingen ventetid.
 *
 * Å bare skippe annonsen i spilleren (spole til slutten) fjerner det synlige, men
 * YouTube bruker fortsatt annonsetiden før den slipper frem videoen — derav «videoen
 * tar like lang tid som annonsen ville tatt». Derfor er pruning primær, skip er reserve.
 *
 *   LAG 1 (primær): fjern annonser fra player-response — via fetch-override
 *     (/youtubei/v1/player) og fra ytInitialPlayerResponse (første sidelasting).
 *   LAG 2 (reserve): hopp over/skjul annonser som likevel dukker opp i spilleren.
 *
 * Vår egen pakkede kode. Kjører i MAIN world ved document_start.
 */
(() => {
  if (window.__bestAdblockYtLoaded) return;
  window.__bestAdblockYtLoaded = true;

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

  // ---------- LAG 1a: fetch-override for player-response ----------
  // Mest pålitelige punkt: SPA-navigasjon henter player via fetch(/youtubei/v1/player).
  try {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = typeof req === 'string' ? req : req && req.url;
        if (url && /\/youtubei\/v1\/(player|next|reel_watch_sequence)/.test(url)) {
          const data = await res.clone().json();
          if (isPlayerResponse(data) || data?.playerResponse) {
            pruneAds(data);
            const headers = new Headers(res.headers);
            headers.delete('content-encoding');
            headers.delete('content-length');
            return new Response(JSON.stringify(data), {
              status: res.status,
              statusText: res.statusText,
              headers,
            });
          }
        }
      } catch { /* ved feil: returner uendret svar */ }
      return res;
    };
  } catch { /* ignorer */ }

  // ---------- LAG 1b: ytInitialPlayerResponse (første sidelasting, inline i HTML) ----------
  try {
    let stored;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(value) {
        try {
          if (isPlayerResponse(value)) pruneAds(value);
        } catch { /* ignorer */ }
        stored = value;
      },
    });
  } catch { /* ignorer */ }

  // ---------- LAG 2: reserve — hopp over/skjul annonser i spilleren ----------
  function skipVideoAd() {
    const player = document.getElementById('movie_player');
    if (player && player.classList.contains('ad-showing')) {
      const video = document.querySelector('.html5-main-video, video');
      if (video && isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        // Spill annonsen i full fart og spol til slutten — henter frem innholdet raskt.
        try {
          video.playbackRate = 16;
          video.currentTime = video.duration;
        } catch { /* ignorer */ }
      }
    }
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, ' +
        '.ytp-ad-skip-button-container button',
    );
    if (skip) skip.click();
    const overlayClose = document.querySelector(
      '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container',
    );
    if (overlayClose) overlayClose.click();
  }
  setInterval(skipVideoAd, 800);

  // ---------- LAG 2b: skjul statiske annonseflater ----------
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
      .ytp-ad-overlay-slot,
      .ytp-ad-overlay-container,
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
})();
