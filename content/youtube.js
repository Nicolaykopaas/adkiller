/**
 * YouTube-annonseblokkering (eksperimentell, av som standard).
 *
 * YouTube-annonser sendes fra samme server som videoen og planlegges via JSON i
 * "player response". Nettverksregler (DNR) kan derfor ikke stoppe dem — den eneste
 * virksomme måten er å fjerne annonsefeltene før spilleren leser dem.
 *
 * Dette er vår egen pakkede kode; ingenting kjøres fra nettet. Scriptet registreres
 * dynamisk av service workeren KUN når brukeren har skrudd på funksjonen, slik at det
 * ikke finnes i nettleseren i det hele tatt når den er av.
 *
 * Forrige forsøk hindret videoer i å spille. Derfor er denne versjonen strengere:
 *  - kun felter som planlegger annonser fjernes
 *  - vi rører kun objekter som faktisk ser ut som en player response
 *  - streamingData / videoDetails / playabilityStatus røres ALDRI (spilleren
 *    trenger dem for å kunne spille av)
 */
(() => {
  if (window.__bestAdblockYtLoaded) return;
  window.__bestAdblockYtLoaded = true;

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const MAX_DEPTH = 8;

  /** Ser objektet ut som en YouTube player response? */
  function isPlayerResponse(o) {
    return !!(
      o &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      (o.streamingData || o.playabilityStatus || o.videoDetails || o.adPlacements || o.playerAds)
    );
  }

  /** Fjerner annonsefelt på plass. Returnerer antall fjernede felter. */
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
        } catch {
          /* ikke-slettbar — la den stå heller enn å kaste */
        }
      }
    }

    // Gå videre nedover for nøstede player responses (f.eks. { playerResponse: {...} }).
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (val && typeof val === 'object') removed += pruneAds(val, depth + 1);
    }
    return removed;
  }

  function tryPrune(data) {
    try {
      if (isPlayerResponse(data)) pruneAds(data);
    } catch {
      /* vår kode skal aldri ødelegge sidens egen parsing */
    }
    return data;
  }

  // 1) JSON.parse — brukes av YouTube for mange interne svar.
  try {
    const nativeParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      return tryPrune(nativeParse.call(this, text, reviver));
    };
  } catch {
    /* ignorer */
  }

  // 2) Response.json — /youtubei/v1/player hentes via fetch ved videobytte i SPA-en.
  try {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      return nativeJson.call(this).then(tryPrune);
    };
  } catch {
    /* ignorer */
  }

  // 3) ytInitialPlayerResponse — settes inline i HTML ved første sidelasting, altså
  //    før noen fetch skjer. Uten denne slipper pre-roll på første video gjennom.
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
  } catch {
    /* ignorer */
  }
})();
