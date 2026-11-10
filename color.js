'use strict';

// Picks a nice accent colour from a picture, and chooses readable text for it.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// bgra: raw pixels as Electron's nativeImage.toBitmap() gives them (blue, green, red, alpha).
function dominantAccent(bgra) {
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    const b = bgra[i], g = bgra[i + 1], r = bgra[i + 2], a = bgra[i + 3];
    if (a < 200) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.12 || l > 0.92 || s < 0.18) continue; // skip near black, near white and grey
    const weight = s * (1 - Math.abs(l - 0.5));
    const bucket = buckets[Math.min(23, Math.floor(h * 24))];
    bucket.w += weight; bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
  }
  const best = buckets.reduce((m, x) => (x.w > m.w ? x : m), buckets[0]);
  if (best.w <= 0) return null;
  const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
  // keep it lively and readable on a dark launcher
  return hslToHex(h, clamp(s, 0.55, 0.9), 0.62);
}

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c);

// Text colour that stays readable on top of this colour.
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111214' : '#ffffff';
}

module.exports = { dominantAccent, inkFor, isHex };
