/**
 * Popup / pop-under-blokkering. Kjører i MAIN world ved document_start slik at den
 * kan overstyre sidens egne window.open-kall FØR siden rekker å bruke dem.
 *
 * Utfordring: aggressive streaming-/piratsider åpner reklame-faner som svar på ET
 * ekte klikk hvor som helst på siden (typisk på videoen). Et enkelt "tillat ved
 * brukergest"-filter slipper disse gjennom. Derfor skiller vi mellom:
 *   - ekte lenke-/knappeklikk som brukeren mente  -> tillat
 *   - kaprede klikk på video/side som åpner en fremmed reklame-URL -> blokker
 */
(() => {
  const GESTURE_WINDOW_MS = 1000;
  let lastGesture = 0;
  let lastClickEl = null;

  // Kjente auth-/betalings-domener der cross-origin popups er legitime (OAuth osv.).
  const ALLOW_HOSTS = [
    'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com',
    'login.live.com', 'www.facebook.com', 'facebook.com', 'www.paypal.com',
    'paypal.com', 'checkout.stripe.com', 'connect.stripe.com', 'github.com',
    'api.twitter.com', 'x.com', 'twitter.com', 'discord.com', 'auth0.com',
  ];

  const markGesture = (e) => {
    // Kun ekte (isTrusted) hendelser teller — sider kan sende falske events.
    if (!e.isTrusted) return;
    lastGesture = Date.now();
    if (e.type === 'click' || e.type === 'auxclick' || e.type === 'pointerup') {
      lastClickEl = e.target;
    }
  };
  for (const evt of ['click', 'auxclick', 'keydown', 'touchend', 'pointerup']) {
    window.addEventListener(evt, markGesture, { capture: true, passive: true });
  }

  const recentGesture = () => Date.now() - lastGesture < GESTURE_WINDOW_MS;
  const blockingOff = () => document.documentElement?.dataset?.bestadblockPopups === 'off';

  function resolveUrl(url) {
    if (!url) return null;
    try {
      return new URL(String(url), location.href);
    } catch {
      return null;
    }
  }

  function hostAllowed(host) {
    return ALLOW_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  }

  /** Fant brukeren en ekte <a>/<button> som peker til (omtrent) samme URL? */
  function clickedRealLinkTo(u) {
    let el = lastClickEl;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const tag = el.tagName;
      if (tag === 'A' && el.href) {
        try {
          const a = new URL(el.href, location.href);
          if (u ? a.host === u.host : a.origin === location.origin) return true;
        } catch { /* ignorer */ }
      }
    }
    return false;
  }

  const realOpen = window.open.bind(window);

  const fakeWindow = () => {
    const noop = () => {};
    return {
      closed: true, close: noop, focus: noop, blur: noop, postMessage: noop,
      document: { write: noop, writeln: noop, close: noop },
      location: { href: '', assign: noop, replace: noop, reload: noop },
    };
  };

  function shouldAllowOpen(u) {
    if (blockingOff()) return true;
    if (!recentGesture()) return false; // ingen brukergest = auto-popup -> blokker
    if (!u) return false;               // window.open('about:blank') popunder -> blokker
    if (u.origin === location.origin) return true; // samme side -> greit
    if (hostAllowed(u.host)) return true;          // kjent OAuth/betaling -> greit
    if (clickedRealLinkTo(u)) return true;         // ekte lenkeklikk -> greit
    return false; // fremmed URL uten ekte lenke = kapret pop-under -> blokker
  }

  const openWrapper = function open(url, target, features) {
    const u = resolveUrl(url);
    if (shouldAllowOpen(u)) return realOpen(url, target, features);
    console.debug('[best-adblock] blokkerte popup:', url);
    return fakeWindow();
  };
  try {
    Object.defineProperty(window, 'open', {
      configurable: true,
      enumerable: true,
      get: () => openWrapper,   // getter returnerer alltid vår wrapper -> ingen bypass
      set: () => {},            // sidens reassignment ignoreres stille -> ingen TypeError
    });
  } catch (err) {
    console.debug('[best-adblock] kunne ikke overstyre window.open', err);
  }

  // Er dette et "overlay"-annonseanker? (tomt, absolutt-posisjonert, dekker stort
  // område, peker til fremmed domene). Typisk på streaming-/piratsider: en usynlig
  // lenke over videoen som kaprer klikket ditt til en reklame-fane.
  function isAdOverlayAnchor(a) {
    if (a.hasAttribute('data-ad-overlay')) return true;
    if ((a.textContent || '').trim().length !== 0) return false; // ingen tekst
    if (a.querySelector('img,svg,picture,video,button')) return false; // ingen media-barn
    let cs;
    try {
      cs = getComputedStyle(a);
    } catch {
      return false;
    }
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
    if (!(a.getAttribute('rel') || '').includes('noopener')) return false; // overlay-popunders setter nesten alltid rel=noopener
    if (cs.backgroundImage !== 'none') return false; // legitime "hero"-lenker har ofte bakgrunnsbilde
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    return r.width * r.height > vw * vh * 0.12; // dekker >12% av vinduet
  }

  function isBadTarget(a) {
    if (!a || !a.href) return false;
    try {
      const u = new URL(a.href, location.href);
      return u.origin !== location.origin && !hostAllowed(u.host);
    } catch {
      return false;
    }
  }

  // Fang pop-unders via anker-klikk. Blokker når:
  //  - klikket er syntetisk (a.click() fra JS, isTrusted === false), eller
  //  - ankeret er et overlay-annonseanker (ekte klikk, men kapret)
  document.addEventListener(
    'click',
    (e) => {
      if (blockingOff()) return;
      const a = e.target?.closest?.('a[target="_blank"], a[target="_new"]');
      if (!isBadTarget(a)) return;
      if (!e.isTrusted || isAdOverlayAnchor(a)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.debug('[best-adblock] blokkerte anker-popup:', a.href);
      }
    },
    { capture: true },
  );

  // Proaktivt nøytraliser overlay-annonseankere så klikk når elementet under
  // (f.eks. videoen) i stedet for å bli slukt. Kun i toppdokumentet.
  if (window.top === window) {
    const neutralize = (root) => {
      let anchors;
      try {
        anchors = root.querySelectorAll('a[data-ad-overlay], a[target="_blank"][rel*="noopener"]');
      } catch {
        return;
      }
      for (const a of anchors) {
        if (isBadTarget(a) && isAdOverlayAnchor(a)) {
          a.style.setProperty('pointer-events', 'none', 'important');
          a.setAttribute('data-bestadblock-neutralized', '1');
        }
      }
    };

    const start = () => {
      neutralize(document);
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'A') {
              if (isBadTarget(node) && isAdOverlayAnchor(node)) {
                node.style.setProperty('pointer-events', 'none', 'important');
              }
            } else if (node.querySelectorAll) {
              neutralize(node);
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  // Auto-submittede popup-former (target=_blank uten brukergest).
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (form && form.target === '_blank' && !blockingOff() && !recentGesture()) {
        form.target = '_self';
      }
    },
    { capture: true },
  );
})();
