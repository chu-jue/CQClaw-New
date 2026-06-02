#!/usr/bin/env node
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "desktop", "tauri-client", "src-tauri", "icons", "icon.png");
const W = 512;
const H = 512;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    Math.round(lerp(a[3], b[3], t)),
  ];
}

function alphaBlend(dst, src) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    return [0, 0, 0, 0];
  }
  return [
    Math.round((src[0] * sa + dst[0] * da * (1 - sa)) / outA),
    Math.round((src[1] * sa + dst[1] * da * (1 - sa)) / outA),
    Math.round((src[2] * sa + dst[2] * da * (1 - sa)) / outA),
    Math.round(outA * 255),
  ];
}

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = clamp(x, left + radius, right - radius);
  const cy = clamp(y, top + radius, bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return Math.hypot(dx, dy) - radius;
}

function rectCoverage(x, y, left, top, right, bottom, radius, feather) {
  const d = roundedRectDistance(x, y, left, top, right, bottom, radius);
  return clamp(0.5 - d / feather, 0, 1);
}

function circleCoverage(x, y, cx, cy, radius, feather) {
  return clamp(0.5 - (Math.hypot(x - cx, y - cy) - radius) / feather, 0, 1);
}

function lineCoverage(x, y, x1, y1, x2, y2, halfWidth, feather) {
  const px = x2 - x1;
  const py = y2 - y1;
  const denom = px * px + py * py || 1;
  const t = clamp(((x - x1) * px + (y - y1) * py) / denom, 0, 1);
  const lx = x1 + t * px;
  const ly = y1 + t * py;
  const d = Math.hypot(x - lx, y - ly) - halfWidth;
  return clamp(0.5 - d / feather, 0, 1);
}

function putPixel(buffer, x, y, rgba) {
  const idx = (y * W + x) * 4;
  buffer[idx] = rgba[0];
  buffer[idx + 1] = rgba[1];
  buffer[idx + 2] = rgba[2];
  buffer[idx + 3] = rgba[3];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const buffer = new Uint8Array(W * H * 4);
const bgTop = [17, 33, 58, 255];
const bgBottom = [15, 23, 42, 255];
const cardTop = [21, 39, 66, 255];
const cardBottom = [12, 20, 36, 255];
const border = [94, 234, 212, 255];
const white = [248, 250, 252, 255];
const blue = [147, 197, 253, 255];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const vertical = y / (H - 1);
    const horizontal = x / (W - 1);
    const base = mixColor(bgTop, bgBottom, vertical);
    const vignette = 1 - 0.14 * Math.hypot(horizontal - 0.5, vertical - 0.5);
    let pixel = [base[0] * vignette, base[1] * vignette, base[2] * vignette, 255];

    const outer = rectCoverage(x, y, 28, 28, 484, 484, 112, 3.5);
    if (outer > 0) {
      const innerFill = mixColor(cardTop, cardBottom, vertical * 0.8);
      pixel = alphaBlend(pixel, [innerFill[0], innerFill[1], innerFill[2], Math.round(outer * 255)]);
    }

    const innerShadow = rectCoverage(x, y, 92, 92, 420, 420, 76, 3);
    if (innerShadow > 0) {
      pixel = alphaBlend(pixel, [8, 15, 30, Math.round(innerShadow * 70)]);
    }

    const outline = rectCoverage(x, y, 92, 92, 420, 420, 76, 2.25);
    if (outline > 0) {
      const edge = clamp(outline * 255, 0, 255);
      pixel = alphaBlend(pixel, [border[0], border[1], border[2], Math.round(edge * 0.9)]);
    }

    const topRail = lineCoverage(x, y, 148, 122, 364, 122, 8, 2.8);
    if (topRail > 0) {
      pixel = alphaBlend(pixel, [31, 41, 55, Math.round(topRail * 120)]);
    }

    const bottomRail = lineCoverage(x, y, 148, 390, 364, 390, 8, 2.8);
    if (bottomRail > 0) {
      pixel = alphaBlend(pixel, [31, 41, 55, Math.round(bottomRail * 120)]);
    }

    const leftNode = circleCoverage(x, y, 188, 190, 20, 2.5);
    if (leftNode > 0) {
      pixel = alphaBlend(pixel, [border[0], border[1], border[2], Math.round(leftNode * 255)]);
    }

    const centerNode = circleCoverage(x, y, 256, 190, 20, 2.5);
    if (centerNode > 0) {
      pixel = alphaBlend(pixel, [white[0], white[1], white[2], Math.round(centerNode * 255)]);
    }

    const rightNode = circleCoverage(x, y, 324, 190, 20, 2.5);
    if (rightNode > 0) {
      pixel = alphaBlend(pixel, [border[0], border[1], border[2], Math.round(rightNode * 255)]);
    }

    const bar = lineCoverage(x, y, 188, 262, 324, 262, 10, 2.5);
    if (bar > 0) {
      pixel = alphaBlend(pixel, [white[0], white[1], white[2], Math.round(bar * 255)]);
    }

    const bar2 = lineCoverage(x, y, 188, 316, 272, 316, 10, 2.5);
    if (bar2 > 0) {
      pixel = alphaBlend(pixel, [blue[0], blue[1], blue[2], Math.round(bar2 * 255)]);
    }

    const accent = lineCoverage(x, y, 184, 184, 324, 184, 2.5, 1.6);
    if (accent > 0) {
      pixel = alphaBlend(pixel, [45, 212, 191, Math.round(accent * 70)]);
    }

    putPixel(buffer, x, y, pixel.map((value) => clamp(Math.round(value), 0, 255)));
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng(W, H, buffer));
console.log(`wrote ${OUT}`);
