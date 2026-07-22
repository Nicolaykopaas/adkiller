# adkiller

**Annonser er leie. Denne utvidelsen dreper dem.**

En Chrome-utvidelse (Manifest V3) bygget på ett prinsipp: ingenting som prøver å selge
deg noe skal få lov til å laste, tegne seg, hoppe opp, spore deg eller stå i veien for
det du faktisk kom for. Reklamebransjen har hatt tretti år på å gjøre nettet uleselig.
Dette er regningen.

---

## Arsenalet

Annonser gjemmer seg på mange måter. Derfor er det syv angrepslinjer, ikke én.

### 1. Nettverksblokkering — de får aldri lastet
~173 000 regler fra AdGuard går rett i strupen på forespørselen. Annonseserveren blir
aldri kontaktet. Ingen bytes, ingen sporing, ingen forsinkelse. Den billigste døden.

### 2. Kosmetisk skjuling — restene ryddes bort
~14 000 generiske og ~12 000 sidespesifikke skjuleregler fjerner det som overlever
nettverkslaget: tomme annonsebokser, «sponset innhold», partnerstudio-artikler som
utgir seg for å være journalistikk. Reglene er **indeksert etter domene**, så en side
slår kun opp sine egne ~25 regler i stedet for å skanne alle 12 000.

### 3. Nøytraliserte stubber — annonsescriptet får lyve
Noen sider nekter å rendre uten annonsescriptet sitt. Fint. Vi serverer dem 43
forfalskede, tomme versjoner — en `adsbygoogle.js` som ikke gjør noe, en analytics som
måler ingenting. Siden tror den fikk det den ba om. Den fikk ingenting.

### 4. Popup- og pop-under-drap
`window.open` er kapret via en accessor siden ikke kan overskrive. Klikk-kaprede
pop-unders, syntetiske lenkeklikk og usynlige overleggslenker lagt over videospillere
blir fanget og nøytralisert — uten å ødelegge ekte lenker eller innloggingsvinduer.

### 5. Leseveggen rives
Sider som laster hele artikkelen og så gjemmer den bak et overlegg får overlegget
fjernet, scroll-låsen brutt og blur-en nullstilt. Kjører automatisk, men **kun når en
vegg faktisk oppdages** — app-sider som Facebook og Gmail røres aldri.

### 6. YouTube (eksperimentell, av som standard)
YouTube-annonser sendes fra samme server som videoen, så nettverksregler er
maktesløse. Løsningen er å fjerne annonsefeltene fra spillerens JSON før den rekker å
lese dem. Skrus på i Innstillinger.

### 7. Element-plukkeren — din egen henrettelse
Noe som overlevde alt dette? Klikk på det. Det kommer ikke tilbake.

---

## Installasjon

Krever Node.js 18+ og Chrome.

```bash
npm install
npm run build     # bygger filterregler, stubber og ikoner
```

`chrome://extensions` → **Developer mode** → **Load unpacked** → velg denne mappen.

> `rules/`, `web-accessible-resources/` og ikonene genereres av bygget og ligger ikke i
> git. Kjør `npm install && npm run build` etter en fersk klone.

---

## Bruk

Klikk ikonet:

| Knapp | Hva den gjør |
|---|---|
| **Av/på** | Total våpenhvile |
| **Tillat annonser på denne siden** | Kapitulasjon, per domene |
| **Blokker et element** | Element-plukkeren |
| **Lås opp artikkel** | River leseveggen nå |
| **⚠ Noe er feil** | Lagrer en feilrapport. Endrer ingenting. |
| **Detaljer** | Hva som faktisk ble drept på denne siden |

Går en side i stykker: skriv én linje i symptomfeltet og trykk **⚠ Noe er feil**.
Rapporten havner i `Nedlastinger/adkiller-reports/` med URL, blokkerte forespørsler per
kategori, kosmetiske treff og regelsett-helse. Knappen rører aldri blokkeringen — et
måleinstrument som endrer det det måler er verdiløst.

---

## Grenser

Ærlighet er bedre enn skryt:

- **Harde betalingsmurer kan ikke fjernes.** Sender serveren aldri teksten, finnes den
  ikke i nettleseren. Vi omgår ikke betaling eller innlogging.
- **Server-sammensydde annonser** (deler av YouTube) er vevd inn i selve videostrømmen.
- **MV3 er svakere enn gamle uBlock Origin.** Chrome fjernet verktøyene. Dekningen er
  god, men ikke identisk.
- **Vilkårlige scriptlets injiseres ikke** — bevisst valg av sikkerhets- og policyhensyn.

---

## Utvikling

```bash
npm run dev       # watcher -> utvidelsen laster seg selv på nytt
npm run verify    # 22 strukturkontroller + fixture-test. Rødt = ingen commit.
npm run build:filters
```

`verify` inneholder regresjonsvakter for hver feil som har vært her før — scroll som
brakk på app-sider, aviser som ikke lastet, faner som ble lastet på nytt midt i en
video. De feilene kommer ikke tilbake.

---

## Filterkilder

[AdGuard DNR-rulesets](https://github.com/AdguardTeam/dnr-rulesets) ·
[EasyList + EasyPrivacy](https://easylist.to/) ·
[Dandelion Sprouts Nordic Filters](https://github.com/DandelionSprout/adfilt) ·
[liamengland1 anti-paywall](https://github.com/liamengland1/miscfilters) ·
[AdGuard Scriptlets](https://github.com/AdguardTeam/Scriptlets) (redirect-stubber)

Takk til alle som vedlikeholder disse listene gratis, år etter år, mot en industri med
uendelig med penger.

---

Personlig prosjekt. Ikke tilknyttet AdGuard, EasyList eller Google.
