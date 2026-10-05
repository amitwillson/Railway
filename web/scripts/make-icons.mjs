/**
 * Generates the PWA raster icons from a simple drawing routine, so the
 * repository carries no binary assets that cannot be regenerated.
 *
 *   node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = draw(x / size, y / size);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BRAND = [11, 79, 108];
const BRAND_DEEP = [8, 58, 81];
const ACCENT = [250, 178, 25];
const INK = [11, 46, 79];
const PAPER = [255, 255, 255];
const GLASS = [173, 214, 235];

/** Distance from point p to segment ab, in unit coordinates. */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/** Rounded rectangle test in unit coordinates. */
function inRoundedRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

/**
 * A railway coach seen head-on, with a verification tick badge.
 * `padding` keeps the artwork inside the maskable safe zone.
 */
function icon(padding) {
  const s = 1 - padding * 2;
  const map = (value) => padding + value * s;

  return (u, v) => {
    if (!inRoundedRect(u, v, 0, 0, 1, 1, 0.16)) return [0, 0, 0, 0];

    // Plate with a subtle vertical gradient
    const base = [
      Math.round(BRAND[0] + (BRAND_DEEP[0] - BRAND[0]) * v),
      Math.round(BRAND[1] + (BRAND_DEEP[1] - BRAND[1]) * v),
      Math.round(BRAND[2] + (BRAND_DEEP[2] - BRAND[2]) * v),
      255,
    ];

    const x = (u - padding) / s;
    const y = (v - padding) / s;
    if (x < 0 || x > 1 || y < 0 || y > 1) return base;

    // The verification badge sits on top of everything, clear of the coach.
    const bx = 0.78;
    const by = 0.78;
    const r = 0.21;
    const d = Math.hypot(x - bx, y - by);
    if (d < r) {
      if (d > r - 0.035) return base; // plate-coloured ring separates it from the coach
      const tick =
        distToSegment(x, y, bx - 0.085, by + 0.005, bx - 0.02, by + 0.07) < 0.03 ||
        distToSegment(x, y, bx - 0.02, by + 0.07, bx + 0.095, by - 0.075) < 0.03;
      return tick ? [...INK, 255] : [...ACCENT, 255];
    }

    // Rails
    if (distToSegment(x, y, 0.1, 0.92, 0.9, 0.92) < 0.024) return [...GLASS, 255];

    // Wheels
    if ((x - 0.3) ** 2 + (y - 0.82) ** 2 < 0.055 ** 2) return [...PAPER, 255];
    if ((x - 0.58) ** 2 + (y - 0.82) ** 2 < 0.055 ** 2) return [...PAPER, 255];

    // Coach body
    if (inRoundedRect(x, y, 0.16, 0.1, 0.72, 0.79, 0.13)) {
      if (inRoundedRect(x, y, 0.22, 0.21, 0.66, 0.43, 0.05)) return [...GLASS, 255];   // window band
      if (inRoundedRect(x, y, 0.27, 0.6, 0.61, 0.66, 0.03)) return [...GLASS, 255];    // headlight strip
      if (Math.abs(x - 0.44) < 0.012 && y > 0.47 && y < 0.77) return [...GLASS, 255];  // door line
      return [...PAPER, 255];
    }

    return base;
  };
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), png(192, icon(0)));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png(512, icon(0)));
// Maskable icons need their content inside the safe zone.
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), png(512, icon(0.06)));
console.info('Icons written to', OUT);
