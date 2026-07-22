# Forbedringsloop — backlog

Arbeidsform per iterasjon:

1. Velg **ett** høyest prioriterte åpne punkt under.
2. Implementer det (bruk gjerne parallelle agenter for uavhengige spor).
3. Kjør `npm run verify` — **må være grønn** før commit.
4. Commit + push, og kryss av punktet her med kort notat.

Regler: aldri push med rød verify. Hver commit skal være selvstendig og reversibel.
Nye feil brukeren melder går forrest i køen, og skal få en regresjonsvakt i `verify.mjs`.

---

## Prioritert kø

### P0 — robusthet og feilsøking
- [ ] **«Noe er ødelagt»-knapp:** ett klikk som midlertidig deaktiverer utvidelsen for
      siden, laster på nytt, og husker valget. Gjør breakage ufarlig.
- [ ] **Trygg re-aktivering av YouTube-pruning:** `content/youtube.js.disabled` brøt
      avspilling. Bygg fixture-test på lagret player-response, og legg den bak et
      av-som-standard flagg i options før den registreres i manifestet igjen.

### P1 — blokkeringskvalitet
- [ ] **Verifiser YouTube-pruningen mot ekte payloads:** legg inn en test som kjører
      `prune()` på et lagret (anonymisert) player-response-fixture og sjekker at
      annonsefelt forsvinner og at `streamingData` er intakt.
- [ ] **Cookie-/samtykkebannere:** auto-avvis i stedet for bare å skjule (skjuling kan
      etterlate scroll-lås). Bruk kjente knappe-selektorer, konservativt.
- [ ] **Anti-adblock-håndtering:** sider som nekter innhold når de oppdager blokkering.
      Kartlegg først hvilke mekanismer som faktisk rammer brukeren.
- [ ] **Flere regionale lister:** vurder AdGuard Mobile/Annoyances og norske tillegg.

### P2 — ytelse
- [ ] **Mål kosmetisk injeksjonskostnad** på tunge sider; vurder å utsette
      `specific-hide`-oppslaget til `requestIdleCallback` når siden er stor.
- [ ] **Lat lasting av storage-oppdaterte lister** (unngå 1 MB `storage.get` per
      navigasjon når en oppdatering finnes).

### P3 — brukeropplevelse
- [ ] **Egne regler i options:** rediger/slett regler fra element-plukkeren, ikke bare
      legg til.
- [ ] **Import/eksport av innstillinger** (whitelist, egne regler, unlock-sider).
- [ ] **Mørk modus** i popup og options.
- [ ] **Element-plukker: angre** siste regel direkte fra popup.

### P4 — vedlikehold
- [ ] **`.gitattributes`** for linjeskift (fjerner CRLF-støyen i git).
- [ ] **Planlagt listeoppdatering** dokumentert (nettverksregler krever rebuild).
- [ ] **LICENSE** hvis repoet noen gang gjøres offentlig.

---

## Ferdig

- [x] Verifiseringsharnisk (`npm run verify`) med regresjonsvakter — 14 sjekker.
- [x] Facebook: unlock ødela scrolling (auto-modus krever nå vegg-deteksjon). `cab74b9`
- [x] Aviser lastet ikke: pakk med AdGuards redirect-stubber. `52b8038`
- [x] Diagnostikk-panel + regelsett-helsesjekk. `3ecfb8f`
- [x] Stoppet to egne regresjoner: fane-reload og ødelagt YouTube. `a893d60`
