/**
 * Cookie-bannere: klikker automatisk «avvis alle» i stedet for bare å skjule dem.
 * Å skjule et samtykke-banner etterlater ofte en scroll-lås og lar sporing stå på;
 * å AVVISE fjerner banneret riktig OG sier nei til valgfrie cookies.
 *
 * To lag:
 *   1) Kjente CMP-avvis-knapper (OneTrust, Cookiebot, Didomi, Quantcast, Sourcepoint,
 *      Usercentrics, Complianz, CookieYes, Osano, Klaro, Termly, Google Funding Choices …)
 *   2) Generisk fallback: en knapp med «avvis»-tekst, men KUN inne i en samtykke-boks,
 *      så vi ikke klikker feil knapp ellers på siden.
 *
 * Kjører i alle frames (noen CMP-er, som Sourcepoint/TrustArc, ligger i en iframe).
 */
(() => {
  if (window.__bestAdblockCookiesLoaded) return;
  window.__bestAdblockCookiesLoaded = true;

  const REJECT_SELECTORS = [
    '#onetrust-reject-all-handler',
    '.ot-pc-refuse-all-handler',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '#CybotCookiebotDialogBodyButtonReject',
    '#didomi-notice-disagree-button',
    '.didomi-continue-without-agreeing',
    '.qc-cmp2-summary-buttons > button[mode="secondary"]',
    '.sp_choice_type_REJECT_ALL',
    'button[title="Reject All"]',
    'button[aria-label="Reject all" i]',
    '[data-testid="uc-deny-all-button"]',
    '#uc-btn-deny-banner',
    '.cmplz-deny',
    '.cky-btn-reject',
    '.osano-cm-denyAll',
    '.cn-decline',
    '._brlbs-btn-cookie-refuse',
    '.t-declineAllButton',
    '.fc-cta-do-not-consent',
    '.fc-secondary-button',
    'button#reject-all',
    'button[data-role="reject-all"]',
    '.termsfeed-com---nb-reject',
    'button[data-gdpr-single-choice-cancel]',
  ];

  const REJECT_TEXT =
    /^(reject all|reject|decline all|decline|deny all|deny|refuse all|refuse|only necessary|necessary only|essential only|avvis alle|avvis|kun nødvendige?|bare nødvendige?|nei takk|godta ikke|avslå)/i;
  const CONSENT_CTX =
    /consent|cookie|gdpr|cmp|privacy|samtykke|didomi|onetrust|cookiebot|usercentrics|sp_message|qc-cmp|truste|osano/i;

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  }

  function inConsentContext(el) {
    let node = el;
    for (let i = 0; node && i < 12; i++, node = node.parentElement) {
      if (node.getAttribute && node.getAttribute('role') === 'dialog') return true;
      const name = `${node.id || ''} ${typeof node.className === 'string' ? node.className : ''}`;
      if (CONSENT_CTX.test(name)) return true;
    }
    return false;
  }

  let done = 0;
  function tryReject() {
    if (done >= 3) return true; // nok — unngå å klikke i det uendelige
    for (const sel of REJECT_SELECTORS) {
      let btn;
      try {
        btn = document.querySelector(sel);
      } catch {
        continue;
      }
      if (btn && isVisible(btn)) {
        btn.click();
        done++;
        console.debug('[best-adblock] avviste cookie-banner via', sel);
        return false;
      }
    }
    for (const b of document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]')) {
      const txt = (b.textContent || b.value || '').trim();
      if (!txt || txt.length > 40 || !REJECT_TEXT.test(txt)) continue;
      if (!inConsentContext(b) || !isVisible(b)) continue;
      b.click();
      done++;
      console.debug('[best-adblock] avviste cookie-banner (tekst):', txt);
      return false;
    }
    return false;
  }

  function start() {
    tryReject();
    // Bannere injiseres ofte litt etter last — observer i en kort periode.
    let scheduled = false;
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (tryReject()) obs.disconnect();
      });
    });
    try {
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch { /* ignorer */ }
    setTimeout(() => obs.disconnect(), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
