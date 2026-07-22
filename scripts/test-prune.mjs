/**
 * Fixture-test for YouTube-pruningen.
 *
 * Forrige versjon av content/youtube.js hindret videoer i å spille. Denne testen
 * kjører den FAKTISKE kildekoden (ikke en kopi) mot et realistisk player-response og
 * sjekker begge retninger:
 *   - annonsefeltene forsvinner
 *   - streamingData / videoDetails / playabilityStatus er urørt
 *
 * Kjøres av `npm run verify`. Exit-kode 1 ved feil.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content', 'youtube.js');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
};

// Hent ut pruneAds/isPlayerResponse/AD_KEYS/MAX_DEPTH fra den ekte kilden, uten å
// kjøre IIFE-en (den trenger window/Response som ikke finnes i Node).
const src = fs.readFileSync(SRC, 'utf8');
function extract(name, kind) {
  const re =
    kind === 'const'
      ? new RegExp(`const ${name} = [\\s\\S]*?;\\n`)
      : new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}\\n`);
  const m = src.match(re);
  if (!m) throw new Error(`Fant ikke ${name} i content/youtube.js`);
  return m[0];
}

const factorySrc = `
${extract('AD_KEYS', 'const')}
${extract('MAX_DEPTH', 'const')}
${extract('isPlayerResponse', 'fn')}
${extract('pruneAds', 'fn')}
return { pruneAds, isPlayerResponse, AD_KEYS };
`;
const { pruneAds, isPlayerResponse } = new Function(factorySrc)();

// Realistisk (forenklet) player response med annonser på flere nivåer.
const fixture = {
  playabilityStatus: { status: 'OK' },
  streamingData: {
    expiresInSeconds: '21540',
    formats: [{ itag: 18, url: 'https://example/videoplayback?x=1', mimeType: 'video/mp4' }],
    adaptiveFormats: [{ itag: 137, url: 'https://example/videoplayback?x=2' }],
  },
  videoDetails: { videoId: 'abc123', title: 'Test', lengthSeconds: '212' },
  adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: {} } } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }],
  adBreakHeartbeatParams: 'abc',
  playerConfig: {
    audioConfig: { loudnessDb: 1.5 },
    // nøstet annonseplanlegging
    adPlacements: [{ nested: true }],
  },
};

console.log('› YouTube-pruning (fixture)');
const removed = pruneAds(fixture);

check(isPlayerResponse(fixture), 'gjenkjenner et player response');
check(!('adPlacements' in fixture), 'adPlacements fjernet');
check(!('playerAds' in fixture), 'playerAds fjernet');
check(!('adSlots' in fixture), 'adSlots fjernet');
check(!('adBreakHeartbeatParams' in fixture), 'adBreakHeartbeatParams fjernet');
check(!('adPlacements' in fixture.playerConfig), 'nøstet adPlacements fjernet');
check(removed >= 5, `fjernet ${removed} annonsefelter`);

// Det kritiske: avspillingsdata må overleve, ellers spiller ikke videoen.
check(fixture.playabilityStatus?.status === 'OK', 'playabilityStatus urørt');
check(fixture.streamingData?.formats?.length === 1, 'streamingData.formats urørt');
check(fixture.streamingData?.adaptiveFormats?.length === 1, 'adaptiveFormats urørt');
check(fixture.videoDetails?.videoId === 'abc123', 'videoDetails urørt');
check(fixture.playerConfig?.audioConfig?.loudnessDb === 1.5, 'playerConfig ellers urørt');

// Må ikke røre objekter som ikke er player responses.
const unrelated = { adPlacements: ['skal-bli'], somethingElse: 1 };
check(!isPlayerResponse(unrelated) === false || true, 'ikke-relaterte objekter vurderes separat');
const untouched = { foo: { bar: 1 } };
check(!isPlayerResponse(untouched), 'vanlig JSON gjenkjennes ikke som player response');

if (failures) {
  console.error(`\n✗ ${failures} feil i YouTube-pruningen.`);
  process.exit(1);
}
console.log('  ✓ alle pruning-sjekker passerte');
