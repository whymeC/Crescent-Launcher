'use strict';

// Works out where the profile picture goes inside a frame, so every frame lines up by itself.
// A frame is a PNG with a see-through middle. We search for the biggest circle that stays (almost)
// clear of the frame. That works for closed rings, open crescents and frames with decorations or
// spikes that stick into the middle. A decoration may cover a tiny part of the circle, nothing more.
// Add a new frame: put the PNG in the "frames" folder and add one line to FRAMES in milestones.js.

const ALPHA_EDGE = 40;      // alpha above this counts as "frame"
const MAX_COVERED = 0.07;  // share of the circle that decorations may cover
const SCALE = 2;            // the search runs on a half size copy to stay fast

function shrink(alpha, w, h) {
  const sw = Math.floor(w / SCALE), sh = Math.floor(h / SCALE);
  const out = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let on = 0;
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) if (alpha[(y * SCALE + dy) * w + x * SCALE + dx] > ALPHA_EDGE) on = 1;
      out[y * sw + x] = on;
    }
  }
  return { data: out, w: sw, h: sh };
}

// Biggest radius around (cx, cy) whose circle is covered less than MAX_COVERED by the frame.
function radiusAt(img, cx, cy, ring, area) {
  const { data, w, h } = img;
  const limit = Math.floor(Math.min(cx, cy, w - cx, h - cy)); // keep the circle inside the picture
  if (limit < 4) return 0;
  ring.fill(0, 0, limit + 1); area.fill(0, 0, limit + 1);
  const y0 = Math.max(0, Math.floor(cy - limit)), y1 = Math.min(h - 1, Math.ceil(cy + limit));
  const x0 = Math.max(0, Math.floor(cx - limit)), x1 = Math.min(w - 1, Math.ceil(cx + limit));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = Math.floor(Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      if (k > limit) continue;
      area[k] += 1;
      if (data[y * w + x]) ring[k] += 1;
    }
  }
  let opaque = 0, total = 0, best = 0;
  for (let k = 0; k <= limit; k++) {
    opaque += ring[k]; total += area[k];
    if (total && opaque / total > MAX_COVERED) break;
    best = k + 1;
  }
  return best;
}

// alpha: one byte per pixel (0 = see-through). Returns the circle in pixels of the original picture.
function fitFrame(alpha, w, h) {
  const img = shrink(alpha, w, h);
  const ring = new Float64Array(img.w + img.h), area = new Float64Array(img.w + img.h);
  const mx = Math.round(img.w * 0.2), my = Math.round(img.h * 0.2);
  let best = { r: 0, x: img.w / 2, y: img.h / 2 };
  const scan = (x0, x1, y0, y1, step) => {
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const r = radiusAt(img, x, y, ring, area);
        const dist = Math.hypot(x - img.w / 2, y - img.h / 2);
        // the bigger circle wins; when two are equal the one closest to the middle wins
        if (r > best.r || (r === best.r && dist < Math.hypot(best.x - img.w / 2, best.y - img.h / 2))) best = { r, x, y };
      }
    }
  };
  scan(Math.round(img.w / 2) - mx, Math.round(img.w / 2) + mx, Math.round(img.h / 2) - my, Math.round(img.h / 2) + my, 6);
  scan(best.x - 6, best.x + 6, best.y - 6, best.y + 6, 1);
  const ok = best.r > Math.min(img.w, img.h) * 0.15;
  if (!ok) return { cx: w / 2, cy: h / 2, r: Math.min(w, h) * 0.3, w, h, ok: false };
  return { cx: (best.x + 0.5) * SCALE, cy: (best.y + 0.5) * SCALE, r: best.r * SCALE, w, h, ok: true };
}

// Where to draw the frame around a picture of size 100%: sizes and offsets in percent of the picture.
// The picture is a little bigger than the see-through circle, so the frame's inner edge always overlaps it.
const TUCK = 0.97;
function placement(fit) {
  const d = 2 * fit.r * TUCK;
  const pc = (v) => Math.round(v * 1000) / 1000;
  return { width: pc((fit.w / d) * 100), height: pc((fit.h / d) * 100), left: pc(50 - (fit.cx / d) * 100), top: pc(50 - (fit.cy / d) * 100) };
}

module.exports = { fitFrame, placement };
