/**
 * Bro mellom bakgrunn (av/på-tilstand) og popup-blokkeren i MAIN world.
 * Kjører i isolert verden i alle frames, henter tilstanden og skriver et flagg på
 * <html data-bestadblock-popups="on|off"> som popup-blocker.js leser.
 */
(async () => {
  if (!document.documentElement) return;
  const config = await chrome.runtime
    .sendMessage({ type: 'getContentConfig' })
    .catch(() => null);
  // Standard er "on" (blokker) til vi vet noe annet; skru av kun når utvidelsen er av.
  const on = !config || config.enabled !== false;
  document.documentElement.dataset.bestadblockPopups = on ? 'on' : 'off';
})();
