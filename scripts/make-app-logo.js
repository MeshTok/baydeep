'use strict';
// 生成 App Logo PNG（零依赖：node 内置 zlib 手写 PNG 编码）。
// 用途：AliExpress 开放平台创建应用要求 100px*100px png/jpg logo。
// 用法：node scripts/make-app-logo.js [输出路径]   默认 website/assets/baydeep-logo-100.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 100, H = 100;
const BG = [10, 102, 255];      // #0A66FF 主色
const DARK = [6, 63, 168];      // #063FA8 对角
const WHITE = [255, 255, 255];

// 中央圆形徽记：|p - center| < r
function pixel(x, y) {
  const dx = x - W / 2, dy = y - H / 2;
  const rOuter = 34, rInner = 26, rDot = 7;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= rDot) return WHITE;                       // 中心点
  if (d >= rInner && d <= rOuter) return WHITE;      // 圆环
  return x + y < W ? DARK : BG;                      // 对角双色底
}

// ---- PNG 编码（无依赖）----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y);
    raw[o++] = r; raw[o++] = g; raw[o++] = b;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
const out = process.argv[2] || path.join(__dirname, '..', 'website', 'assets', 'baydeep-logo-100.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('[logo] wrote ' + out + ' (' + png.length + ' bytes, ' + W + 'x' + H + ')');
