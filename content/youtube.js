/**
 * YouTube-annonseblokkering.
 *
 * YouTube-annonser serveres fra samme origin som videoen og planlegges via JSON i
 * "player response". Nettverksregler (DNR) kan derfor ikke stoppe dem. Løsningen er å
 * fjerne annonsefeltene fra dette JSON-objektet før spilleren rekker å lese dem.
 *
 * Dette er VÅR EGEN kode som følger med i pakken — ingen fjernkjørt kode. Kjører i MAIN
 * world ved document_start, før YouTubes egne script.
 */
(() => {
  // Felter YouTube bruker til å planlegge annonser.
  const AD_KEYS = new Set([
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'importantForAds',
  ]);

  const MAX_DEPTH = 12;

  /** Fjerner annonsefelt rekursivt, med dybdegrense så store objekter ikke koster for mye. */
  function prune(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return obj;

    if (Array.isArray(obj)) {
      for (const item of obj) prune(item, depth + 1);
      return obj;
    }

    for (const key of Object.keys(obj)) {
      if (AD_KEYS.has(key)) {
        try {
          delete obj[key];
        } catch { /* ikke-slettbar — ignorer */ }
        continue;
      }
      const val = obj[key];
      if (val && typeof val === 'object') prune(val, depth + 1);
    }
    return obj;
  }

  /** Er dette sannsynligvis en YouTube player-response? (unngå å tygge på alt) */
  function looksLikePlayerResponse(obj) {
    return (
      obj &&
      typeof obj === 'object' &&
      ('adPlacements' in obj ||
        'playerAds' in obj ||
        'streamingData' in obj ||
        'playerResponse' in obj ||
        'playabilityStatus' in obj)
    );
  }

  // ---- 1) JSON.parse: fanger de fleste player-responses ----
  const nativeParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const data = nativeParse.call(this, text, reviver);
    try {
      if (looksLikePlayerResponse(data)) prune(data);
    } catch { /* aldri la vår kode ødelegge sidens parsing */ }
    return data;
  };

  // ---- 2) Response.prototype.json: fetch-baserte svar ----
  try {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      return nativeJson.call(this).then((data) => {
        try {
          if (looksLikePlayerResponse(data)) prune(data);
        } catch { /* ignorer */ }
        return data;
      });
    };
  } catch { /* ignorer */ }

  // ---- 3) ytInitialPlayerResponse: settes som global før spilleren starter ----
  try {
    let stored;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() {
        return stored;
      },
      set(value) {
        try {
          if (value && typeof value === 'object') prune(value);
        } catch { /* ignorer */ }
        stored = value;
      },
    });
  } catch { /* ignorer */ }
})();
