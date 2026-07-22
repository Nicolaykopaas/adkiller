/**
 * DNR-diagnose: laster utvidelsen, kobler til service workeren, og spør Chrome direkte
 * om regelsettene er aktive og om konkrete annonse-URL-er faktisk ville blitt blokkert
 * (chrome.declarativeNetRequest.testMatchOutcome). Skiller «utvidelsen er av» fra
 * «reglene dekker ikke denne URL-en».
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:url';

const ROOT = path.resolve(path.dirname(os.fileURLToPath(import.meta.url)), '..');
const PORT = 9334;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'adkiller-dnr-profile');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const TEST_URLS = [
  ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script'],
  ['https://securepubads.g.doubleclick.net/gampad/ads?foo=1', 'xmlhttprequest'],
  ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script'],
  ['https://www.googletagservices.com/tag/js/gpt.js', 'script'],
  ['https://c.amazon-adsystem.com/aax2/apstag.js', 'script'],
  ['https://micro.rubiconproject.com/prebid/dynamic/15770.js', 'script'],
  ['https://adx.adform.net/adx/openrtb', 'xmlhttprequest'],
];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) for (const l of this.listeners) l(m);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const p = { id, method, params }; if (sessionId) p.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(p));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }
}

async function run() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  // Moderne Chrome ignorerer --load-extension. Vi laster i stedet via CDP
  // Extensions.loadUnpacked, som krever --enable-unsafe-extension-debugging.
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 40; i++) { try { ver = await getJson(`http://localhost:${PORT}/json/version`); break; } catch { await sleep(500); } }
  if (!ver) { chrome.kill(); throw new Error('debug-port svarte ikke'); }
  await sleep(6000); // la DNR indeksere 173k regler

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new CDP(ws);

  // Last utvidelsen via CDP (moderne Chrome ignorerer --load-extension).
  try {
    const r = await cdp.send('Extensions.loadUnpacked', { path: ROOT });
    console.log('› Extensions.loadUnpacked OK:', JSON.stringify(r));
  } catch (e) {
    chrome.kill();
    throw new Error('Extensions.loadUnpacked feilet: ' + e.message);
  }
  await sleep(6000); // la DNR indeksere reglene

  // Vekk vår service worker: åpne en ekte side slik at content-scriptene melder til
  // bakgrunnen (MV3 SW sover når den er inaktiv og vises da ikke som target).
  const { targetId: wakeTab } = await cdp.send('Target.createTarget', { url: 'https://example.com' });
  await sleep(4000);

  // DIAGNOSE: dump alle targets + sjekk om content-scriptet vårt kjørte på wake-tab.
  const all = await cdp.send('Target.getTargets');
  console.log('\n› Alle targets:');
  for (const t of all.targetInfos) console.log(`  ${t.type.padEnd(16)} ${t.url.slice(0, 70)}`);
  const { sessionId: wsid } = await cdp.send('Target.attachToTarget', { targetId: wakeTab, flatten: true });
  await cdp.send('Runtime.enable', {}, wsid);
  try {
    const chk = await cdp.send('Runtime.evaluate', {
      expression: "JSON.stringify({ genericStyle: !!document.getElementById('best-adblock-generic'), specificStyle: !!document.getElementById('best-adblock-specific'), title: document.title })",
      returnByValue: true,
    }, wsid);
    console.log('\n› Content-script på example.com:', chk.result.value);
  } catch (e) {
    console.log('  kunne ikke sjekke wake-tab:', e.message);
  }

  // Finn VÅR service worker: flere utvidelser (også Chromes egne) kan ha en SW, så
  // vi identifiserer riktig via manifest-navnet.
  const { targetInfos } = await cdp.send('Target.getTargets');
  const candidates = targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
  let sessionId = null;
  for (const c of candidates) {
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId: c.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sid);
    let name = '';
    for (let i = 0; i < 5; i++) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: "String(chrome && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().name : 'NO_CHROME')", returnByValue: true }, sid);
        name = r.result.value;
        if (name && name !== 'NO_CHROME') break;
      } catch (e) { name = 'ERR:' + e.message; }
      await sleep(800);
    }
    console.log(`  SW ${c.url.slice(0, 55)} -> navn: ${name}`);
    if (name === 'Best AdBlock') { sessionId = sid; break; }
  }
  if (!sessionId) {
    console.log('SW-kandidater:', candidates.map((t) => t.url.slice(0, 70)).join('\n'));
    chrome.kill();
    throw new Error('Fant ikke «Best AdBlock»-service workeren');
  }

  const evalInSw = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails;
      throw new Error(ex.exception?.description || ex.exception?.value || ex.text || JSON.stringify(ex));
    }
    return r.result.value;
  };

  console.log('› Regelsett-status');
  const enabled = await evalInSw('chrome.declarativeNetRequest.getEnabledRulesets()');
  const avail = await evalInSw('chrome.declarativeNetRequest.getAvailableStaticRuleCount()');
  console.log('  aktive regelsett:', JSON.stringify(enabled));
  console.log('  ledige statiske regler:', avail);

  console.log('\n› testMatchOutcome for annonse-URL-er (blokkert? redirect? tillatt?)');
  for (const [url, type] of TEST_URLS) {
    const expr = `chrome.declarativeNetRequest.testMatchOutcome({ url: ${JSON.stringify(url)}, type: ${JSON.stringify(type)}, initiator: 'https://www.dagbladet.no' })`;
    try {
      const res = await evalInSw(expr);
      const rules = res.matchedRules || [];
      const verdict = rules.length ? rules.map((r) => `${r.rulesetId}#${r.ruleId}`).join(',') : 'INGEN TREFF (slipper gjennom)';
      console.log(`  ${url.slice(0, 62).padEnd(64)} -> ${verdict}`);
    } catch (e) {
      console.log(`  ${url.slice(0, 62)} -> feil: ${e.message}`);
    }
  }

  ws.close();
  chrome.kill();
}

run().catch((e) => { console.error('✗', e); process.exit(1); });
