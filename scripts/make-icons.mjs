/**
 * Genererer enkle PNG-ikoner (16/48/128) uten eksterne avhengigheter.
 * Tegner en rund "skjold"-lignende skive med en diagonal strek (blokkerings-symbol).
 * Skriver ekte PNG-filer via en minimal, avhengighetsfri PNG-encoder (zlib fra Node).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, '..', 'assets');

const BG = [28, 28, 34, 255]; // mørk
const FG = [211, 54, 130, 255]; // rosa (blokkert-farge)
const RING = [255, 255, 255, 255];

function makePixels(size) {
  const px = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const r = size * 0.44;
  const rInner = size * 0.30;
  const strokeW = Math.max(1.4, size * 0.10);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);

      let color = [0, 0, 0, 0]; // transparent utenfor
      if (dist <= r) color = BG;
      if (dist <= r && dist >= r - Math.max(1, size * 0.06)) color = RING;

      // Diagonal "forbudt"-strek: avstand fra linja y = x (gjennom sentrum).
      const lineDist = Math.abs(dx + dy) / Math.SQRT2;
      if (dist <= rInner + strokeW && lineDist <= strokeW / 2) color = FG;

      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }
  return px;
}

// --- Minimal PNG-encoder ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // raw scanlines med filter-byte 0 foran hver rad
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(ASSETS, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePNG(size, makePixels(size));
  fs.writeFileSync(path.join(ASSETS, `icon-${size}.png`), png);
  console.log(`  skrev assets/icon-${size}.png (${png.length} bytes)`);
}
console.log('✓ Ikoner generert.');
