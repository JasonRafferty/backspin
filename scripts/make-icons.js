// Draws the app + tray icons as PNGs (no dependencies). Run: npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// shader(x, y) gets coords in -1..1 and returns [r, g, b, a] (0..255, a 0..1).
function render(size, shader, samples = 4) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / samples) / size) * 2 - 1;
          const [cr, cg, cb, ca] = shader(x, y);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const n = samples * samples;
      out[i] = a ? r / a : 0;
      out[i + 1] = a ? g / a : 0;
      out[i + 2] = a ? b / a : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, out);
}

const mix = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * t);

function colourRecord(x, y) {
  const d = Math.hypot(x, y);
  if (d > 0.94) return [0, 0, 0, 0];
  if (d < 0.045) return [40, 40, 44, 1];
  if (d < 0.36) {
    const label = d > 0.33 ? [200, 66, 46] : [232, 86, 63];
    return [...label, 1];
  }
  let c = mix([18, 18, 20], [34, 34, 38], 0.5 + 0.5 * Math.sin(d * 150));
  if (d > 0.9) c = [44, 44, 50];
  const theta = Math.atan2(y, x);
  const sheen = Math.pow(Math.max(0, Math.cos(2 * (theta + 0.8))), 10) * 70;
  return [c[0] + sheen, c[1] + sheen, c[2] + sheen, 1];
}

function templateRecord(x, y) {
  const d = Math.hypot(x, y);
  const filled = d < 0.94 && !(d > 0.3 && d < 0.42) && d > 0.1;
  return [0, 0, 0, filled ? 1 : 0];
}

const files = {
  'icon.png': render(1024, colourRecord),
  'tray.png': render(32, colourRecord, 6),
  'trayTemplate.png': render(16, templateRecord, 8),
  'trayTemplate@2x.png': render(32, templateRecord, 8),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, png] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('wrote', path.join('assets', name));
}
