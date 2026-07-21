# Best AdBlock

En kraftig, personlig annonseblokkerer for Chrome (Manifest V3). Blokkerer reklame,
sporing, popups og pop-unders på alle nettsider, skjuler «annonsørinnhold», og kan låse
opp artikler bak myke lesevegger — bygget på etablerte filterlister (AdGuard, EasyList,
Nordic, anti-paywall).

## Funksjoner

- **Nettverksblokkering (DNR):** ~173 000 forhåndsbygde AdGuard-regler stopper annonse-
  og sporingsforespørsler før de lastes.
- **Kosmetisk skjuling:** ~14 000 generiske + ~12 000 sidespesifikke element-hiding-regler
  fra EasyList/EasyPrivacy + Dandelion Sprouts Nordic-liste (skjuler bl.a. VGs
  «annonsørinnhold»/partnerstudio).
- **Popup- & pop-under-blokkering:** fanger kaprede klikk (også overlegg-lenker over
  videoer på streaming-/piratsider) uten å ødelegge ekte lenker og innloggings-popups.
- **Lås opp artikkel:** fjerner myke lesevegger (overlegg, scroll-lås, blur) der teksten
  alt er lastet. På som standard for alle sider.
- **Element-plukker:** klikk et element for å lage din egen skjuleregel.
- **Av/på + whitelist per side**, badge-teller, og innstillingsside.
- **Auto-oppdatering** av kosmetiske lister (ukentlig + manuelt).
- **Hot-reload** i utvikling — utvidelsen laster seg selv på nytt ved filendringer.

## Kom i gang

Krever [Node.js](https://nodejs.org/) 18+ og Google Chrome (eller Edge/Brave).

```bash
npm install      # henter build-avhengigheter
npm run build    # genererer ikoner + filterregler (rules/) + version.json
```

Last inn i Chrome:

1. Åpne `chrome://extensions`
2. Slå på **Developer mode** (øverst til høyre)
3. Klikk **Load unpacked** og velg denne mappen

> Merk: `rules/`, `version.json` og ikonene genereres av `npm run build` og er ikke i git.
> Kjør derfor `npm install && npm run build` etter en fersk klone før du laster inn.

## Bruk

Klikk verktøylinje-ikonet:

| Handling | Hva den gjør |
|----------|--------------|
| **Av/på-bryter** | Skrur all blokkering av/på |
| **Tillat annonser på denne siden** | Whitelister domenet (dynamisk allow-regel) |
| **Blokker et element** | Starter element-plukkeren |
| **Lås opp artikkel** | Fjerner myk lesevegg på siden nå |
| **Alltid lås opp denne siden** | Auto-opplåsing for domenet |

Under **Innstillinger**: skru filterkategorier av/på, administrer whitelist og egne
regler, styr auto-opplåsing, og oppdater kosmetiske lister.

## Lås opp artikkel — hvordan og begrensning

Mange sider laster hele artikkelen, men skjuler den bak et overlegg, scroll-lås eller
blur. Motoren gjenoppretter scrolling, fjerner overlegg/modaler (som matcher
`paywall|subscribe|regwall|newsletter…`, men aldri `article/main/content`), og nullstiller
blur/tekstklipp — pluss overvåker DOM-en i noen sekunder for sent-injiserte modaler.

> **Begrensning:** dette virker kun når innholdet allerede er sendt til nettleseren.
> Harde betalingsmurer, der serveren aldri leverer teksten, kan ikke og skal ikke omgås.

## Utvikling

```bash
npm run dev            # watcher: bumper version.json ved filendringer -> hot-reload
npm run build:filters  # oppdater filterreglene på nytt
npm run bump           # trigg hot-reload manuelt
```

Hot-reload er **kun aktiv i dev** (utpakket utvidelse) — oppdages via `onRuleMatchedDebug`,
som bare finnes for utpakkede utvidelser. En publisert utvidelse self-reloader aldri.

## Arkitektur

```
manifest.json                  MV3-manifest
background/service-worker.js   av/på, whitelist, badge, unlock-state, list-oppdatering, hot-reload
content/
  popup-blocker.js             popup/pop-under-blokkering (MAIN world)
  state-bridge.js              bro av/på-tilstand til popup-blocker
  cosmetic.js                  injiserer kosmetiske skjuleregler (domene-indeksert)
  reader-unlock.js             "lås opp artikkel"-motor
  element-picker.js            element-plukker (injiseres på forespørsel)
popup/                         verktøylinje-UI
options/                       innstillingsside
scripts/
  build-filters.mjs            bygger DNR- + kosmetiske regler
  make-icons.mjs               genererer ikoner
  bump-version.mjs             bumper version.json
  watch.mjs                    dev-watcher
rules/          (generert)     DNR-regelsett + kosmetiske regler
version.json    (generert)     hot-reload-stempel
```

## Filterkilder

- [AdGuard DNR-rulesets](https://github.com/AdguardTeam/dnr-rulesets) (Base, Tracking,
  Popups, Cookie Notices, Other Annoyances)
- [EasyList + EasyPrivacy](https://easylist.to/)
- [Dandelion Sprouts Nordic Filters](https://github.com/DandelionSprout/adfilt)
- [liamengland1 anti-paywall](https://github.com/liamengland1/miscfilters)

## Begrensninger

- MV3/`declarativeNetRequest` er mindre fleksibelt enn gamle uBlock Origin (MV2).
  Dekningen er svært god, men ikke 100 % identisk.
- YouTube-annonser er delvis server-side og dekkes ikke fullstendig.
- Vi injiserer ikke vilkårlige scriptlets (Chrome Web Store-policy / sikkerhet).
- Filterlistene bør oppdateres jevnlig (kosmetikk auto-oppdateres; nettverk via rebuild).

## Personlig bruk

Bygget som et personlig prosjekt. Ikke tilknyttet AdGuard, EasyList eller Google.
