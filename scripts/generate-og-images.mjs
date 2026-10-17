/**
 * Generate placeholder Open Graph images.
 *
 * `Layout.astro` references `/og-default.png` and `/og-tld.png`. Social
 * platforms generally do not render SVG for `og:image`, so these must be real
 * PNGs or crawlers (and AdSense's page-quality review) see a 404.
 *
 * These are deliberate minimal placeholders: a solid brand background.
 * Replace them with designed artwork once branding is final.
 *
 * Usage: node scripts/generate-og-images.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public');

const W = 1200;
const H = 630;

/** Brand palette (matches src/styles/global.css @theme tokens). */
const BG = [0x14, 0x49, 0xe1];
const PANEL = [0xff, 0xff, 0xff];
const BAR = [0xd9, 0xeb, 0xff];

/** Build raw RGBA scanlines. */
function buildRows(kind) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3); // 1 filter byte + RGB
    row[0] = 0; // no filter
    for (let x = 0; x < W; x++) {
      const i = 1 + x * 3;
      let c = BG;
      const inPanel =
        kind === 'tld'
          ? x > 120 && x < W - 120 && y > 170 && y < H - 170
          : x > 260 && x < W - 260 && y > 150 && y < H - 150;
      if (inPanel) c = PANEL;
      // A simple accent rule near the top of the panel to avoid a flat box.
      if (kind === 'default' && y >= 205 && y <= 225 && x > 320 && x < W - 320) c = BAR;
      if (kind === 'tld' && y >= 225 && y <= 250 && x > 190 && x < W - 190) c = BAR;
      row[i] = c[0];
      row[i + 1] = c[1];
      row[i + 2] = c[2];
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

/** Minimal PNG encoder: truecolour 8-bit, no interlace. */
function encodePng(width, height, rows) {
  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(width, 0);
  IHDR.writeUInt32BE(height, 4);
  IHDR[8] = 8; // bit depth
  IHDR[9] = 2; // colour type: truecolour RGB
  IHDR[10] = 0; // deflate
  IHDR[11] = 0; // adaptive filtering
  IHDR[12] = 0; // no interlace

  const idat = deflateSync(rows);

  const chunks = [
    { type: 'IHDR', data: IHDR },
    { type: 'IDAT', data: idat },
  ];

  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const { type, data } of chunks) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    out.push(len, typeBuf, data, crc);
  }
  return Buffer.concat(out);
}

/** CRC-32 as required by the PNG spec. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'og-default.png'), encodePng(W, H, buildRows('default')));
writeFileSync(resolve(OUT_DIR, 'og-tld.png'), encodePng(W, H, buildRows('tld')));
console.log('Wrote public/og-default.png and public/og-tld.png (1200x630 placeholders).');
