/**
 * Ad-testverktøy: laster utvidelsen i en ekte Chrome (via DevTools-protokollen),
 * navigerer til annonsetunge sider, teller annonser som slapp gjennom (DOM + nettverk),
 * og tar skjermbilder. Ingen avhengigheter — bruker Node 21+ sin innebygde WebSocket.
 *
 * Bruk:
 *   node scripts/adtest.mjs                 # standard testsider
 *   node scripts/adtest.mjs https://... ... # egne sider
 *
 * Krever at Chrome ikke allerede kjører på samme profil — vi bruker egen profil + port.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:url';

const ROOT = path.resolve(path.dirname(os.fileURLToPath(import.meta.url)), '..');
const PORT = 9333;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'adkiller-adtest-profile');
const OUT = path.join(process.env.TEMP || '/tmp', 'adkiller-adtest');
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://www.dagbladet.no',
      'https://www.nettavisen.no',
      'https://www.speedtest.net',
    ];

const AD_HOST = /doubleclick|googlesyndication|googleadservices|adservice\.google|2mdn|adnxs|amazon-adsystem|taboola|outbrain|criteo|pubmatic|rubiconproject|casalemedia|adform|smartadserver|followaudacious|moatads|scorecardresearch/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// ---------- minimal CDP-klient over browser-WebSocket (flat sessions) ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30000);
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

const DETECT = `(() => {
  const AD = ${AD_HOST.toString()};
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  const iframes = [...document.querySelectorAll('iframe')].filter((f) => {
    try { return AD.test(f.src); } catch { return false; }
  });
  const sel = 'ins.adsbygoogle,.adsbygoogle,[id^="google_ads"],[id*="div-gpt-ad"],[data-ad-slot],[data-ad-client],[id*="dfp"],[class*="advert"],[aria-label="Advertisement" i],[aria-label="Ad" i]';
  const els = [...document.querySelectorAll(sel)].filter(vis);
  return JSON.stringify({
    adIframes: iframes.length,
    iframeSrc: iframes.slice(0, 5).map((f) => f.src.slice(0, 90)),
    visibleAdEls: els.length,
    sampleEls: els.slice(0, 8).map((e) =>
      (e.tagName + '#' + (e.id || '') + '.' + (typeof e.className === 'string' ? e.className : '')).slice(0, 60)
    ),
  });
})()`;

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  console.log('› Starter Chrome med utvidelsen lastet …');
  // Moderne Chrome ignorerer --load-extension. Vi laster i stedet via CDP
  // Extensions.loadUnpacked (krever --enable-unsafe-extension-debugging).
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // Vent til debug-endepunktet svarer.
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await getJson(`http://localhost:${PORT}/json/version`);
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!version) {
    chrome.kill();
    throw new Error('Chrome debug-port svarte ikke');
  }
  // Gi service workeren + DNR-regelsettene tid til å laste.
  await sleep(4000);

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  // Last utvidelsen via CDP, ellers måler vi en ubeskyttet nettleser.
  try {
    await cdp.send('Extensions.loadUnpacked', { path: ROOT });
    console.log('  utvidelsen lastet via CDP');
  } catch (e) {
    ws.close();
    chrome.kill();
    throw new Error('Extensions.loadUnpacked feilet: ' + e.message);
  }
  await sleep(6000); // la DNR indeksere reglene

  const results = [];
  for (const url of SITES) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    console.log(`\n› ${host}`);
    const adResponses = new Set();

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    const onEvent = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Network.responseReceived') {
        const u = msg.params.response?.url || '';
        if (AD_HOST.test(u)) adResponses.add(u.slice(0, 90));
      }
    };
    cdp.on(onEvent);

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    try {
      await cdp.send('Page.navigate', { url }, sessionId);
      await sleep(7000); // la siden + late annonser laste

      const evalRes = await cdp.send(
        'Runtime.evaluate',
        { expression: DETECT, returnByValue: true },
        sessionId,
      );
      const detected = JSON.parse(evalRes.result.value);

      const shot = await cdp.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false },
        sessionId,
      );
      const file = path.join(OUT, `${host}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      const r = {
        host,
        adIframes: detected.adIframes,
        visibleAdEls: detected.visibleAdEls,
        adNetworkResponses: adResponses.size,
        iframeSrc: detected.iframeSrc,
        sampleEls: detected.sampleEls,
        adResponseSample: [...adResponses].slice(0, 6),
        screenshot: file,
      };
      results.push(r);
      console.log(
        `  annonse-iframes: ${r.adIframes} | synlige annonse-elementer: ${r.visibleAdEls} | ` +
          `annonse-nettverkssvar: ${r.adNetworkResponses}`,
      );
      if (r.adResponseSample.length) console.log('  nettverk:', r.adResponseSample.join('  '));
      if (r.sampleEls.length) console.log('  elementer:', r.sampleEls.join('  '));
      console.log('  skjermbilde:', file);
    } catch (err) {
      console.log('  FEIL:', err.message);
    } finally {
      cdp.listeners = cdp.listeners.filter((l) => l !== onEvent);
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
  console.log(`\n✓ Ferdig. Oppsummering: ${path.join(OUT, 'summary.json')}`);
  ws.close();
  chrome.kill();
}

run().catch((err) => {
  console.error('✗ adtest feilet:', err);
  process.exit(1);
});
