/**
 * YouTube-test: laster utvidelsen, går til en video, og sjekker at annonser er fjernet
 * fra player-response (adPlacements/playerAds) + overvåker om spilleren viser annonse
 * (.ad-showing). Tar skjermbilde. Bruk: node scripts/yt-test.mjs [videoId]
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:url';

const ROOT = path.resolve(path.dirname(os.fileURLToPath(import.meta.url)), '..');
const PORT = 9336;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'adkiller-yt-profile');
const OUT = path.join(process.env.TEMP || '/tmp', 'adkiller-adtest');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VIDEO = process.argv[2] || 'mkjvJRiHEq4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString())); } catch (e) { rej(e); } }); }).on('error', rej));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const p = { id, method, params }; if (sessionId) p.sessionId = sessionId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify(p)); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000); });
  }
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 40; i++) { try { ver = await getJson(`http://localhost:${PORT}/json/version`); break; } catch { await sleep(500); } }
  if (!ver) { chrome.kill(); throw new Error('debug-port svarte ikke'); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new CDP(ws);
  await cdp.send('Extensions.loadUnpacked', { path: ROOT });
  console.log('utvidelsen lastet; åpner video', VIDEO);
  await sleep(5000);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, sessionId);

  // Overvåk annonsetilstand i 22 sekunder.
  let sawAd = false;
  let firstContentAt = null;
  const t0 = Date.now();
  for (let i = 0; i < 22; i++) {
    await sleep(1000);
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const p = document.getElementById('movie_player');
          const v = document.querySelector('video');
          const pr = window.ytInitialPlayerResponse;
          return JSON.stringify({
            adShowing: !!(p && p.classList.contains('ad-showing')),
            hasAdPlacements: !!(pr && (pr.adPlacements || pr.playerAds)),
            playing: !!(v && !v.paused && v.currentTime > 0),
            t: v ? Math.round(v.currentTime * 10) / 10 : null,
          });
        })()`,
        returnByValue: true,
      }, sessionId);
      const s = JSON.parse(r.result.value);
      if (s.adShowing) sawAd = true;
      if (!s.adShowing && s.playing && firstContentAt == null) firstContentAt = ((Date.now() - t0) / 1000).toFixed(1);
      if (i % 3 === 0 || s.adShowing) {
        console.log(`  ${i}s: adShowing=${s.adShowing} adPlacements=${s.hasAdPlacements} playing=${s.playing} t=${s.t}`);
      }
    } catch { /* siden navigerer */ }
  }

  // Dump synlige annonse-/promo-elementer for presis targeting.
  try {
    const insp = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 3 && r.height > 3; };
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase();
          const id = (el.id || '');
          const cls = (typeof el.className === 'string' ? el.className : '');
          const hay = (tag + ' ' + id + ' ' + cls).toLowerCase();
          if (/(^|[^a-z])ad(-|_|s|$)|sponsor|promo|mealbar|premium/.test(hay) && vis(el)) {
            out.push(tag + (id ? '#' + id : '') + (cls ? '.' + cls.split(' ').slice(0,3).join('.') : ''));
          }
        }
        return JSON.stringify([...new Set(out)].slice(0, 30));
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('\nSynlige annonse/promo-elementer:');
    for (const s of JSON.parse(insp.result.value)) console.log('  ' + s);
  } catch (e) { console.log('inspeksjon feilet:', e.message); }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(OUT, `youtube-${VIDEO}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('\nRESULTAT:');
  console.log('  så annonse i spilleren:', sawAd);
  console.log('  innhold spilte fra ca:', firstContentAt ? firstContentAt + 's' : 'usikkert');
  console.log('  skjermbilde:', file);

  ws.close();
  chrome.kill();
}

run().catch((e) => { console.error('✗', e); process.exit(1); });
