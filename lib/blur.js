// Hide faces, number plates and house numbers in a photo, on the phone, before anything is uploaded.
// We PIXELATE (replace each block with its average colour) instead of blurring: a strong blur can
// sometimes be partly reversed, a coarse mosaic cannot. Pure functions, so they are tested in Node.

// Turn two drag points (any corner order, any scale) into a rectangle clamped inside the image.
export function normRect(a, b, width, height) {
  const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width, Math.max(a.x, b.x)), y1 = Math.min(height, Math.max(a.y, b.y));
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// Ignore accidental taps: a box must be at least `min` pixels on both sides.
export const isUsableRect = (r, min = 12) => !!r && r.w >= min && r.h >= min;

// Block size grows with the box, so a big box is hidden as firmly as a small one:
// about 4 blocks across the shorter side, never smaller than 6 px.
export function blockSize(r) {
  return Math.max(6, Math.round(Math.min(r.w, r.h) / 4));
}

// Add a margin so a slightly-off box still covers the whole face or plate.
export function grow(r, pct, width, height) {
  const mx = r.w * pct, my = r.h * pct;
  return normRect({ x: r.x - mx, y: r.y - my }, { x: r.x + r.w + mx, y: r.y + r.h + my }, width, height);
}

// Pixelate one rectangle of RGBA pixel data (like ImageData.data) in place.
export function pixelate(data, width, height, rect) {
  const r = normRect({ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, width, height);
  if (r.w < 1 || r.h < 1) return data;
  const bs = blockSize(r);
  for (let by = r.y; by < r.y + r.h; by += bs) {
    for (let bx = r.x; bx < r.x + r.w; bx += bs) {
      const ex = Math.min(bx + bs, r.x + r.w), ey = Math.min(by + bs, r.y + r.h);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * width + x) * 4; sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
      }
      const ar = Math.round(sr / n), ag = Math.round(sg / n), ab = Math.round(sb / n);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * width + x) * 4; data[i] = ar; data[i + 1] = ag; data[i + 2] = ab;
      }
    }
  }
  return data;
}

export function pixelateAll(data, width, height, rects) {
  for (const r of rects) if (isUsableRect(r, 1)) pixelate(data, width, height, r);
  return data;
}

// ---- Keyboard / button control of one box (for people who cannot drag) ----

// A starting box in the middle of the photo, about a fifth of the shorter side.
export function defaultBox(width, height) {
  const side = Math.max(24, Math.round(Math.min(width, height) / 5));
  return normRect({ x: width / 2 - side / 2, y: height / 2 - side / 2 }, { x: width / 2 + side / 2, y: height / 2 + side / 2 }, width, height);
}

// One press moves or resizes by about 5% of the photo's longer side (at least 4 px).
export const stepSize = (width, height) => Math.max(4, Math.round(Math.max(width, height) / 20));

// Move a box, keeping it fully inside the photo and keeping its size.
export function nudge(r, dx, dy, width, height) {
  const x = Math.max(0, Math.min(width - r.w, r.x + dx));
  const y = Math.max(0, Math.min(height - r.h, r.y + dy));
  return { ...r, x: Math.round(x), y: Math.round(y) };
}

// Grow or shrink a box around its centre; never below `min`, never outside the photo.
export function resize(r, dw, dh, width, height, min = 12) {
  const w = Math.max(min, Math.min(width, r.w + dw)), h = Math.max(min, Math.min(height, r.h + dh));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const x = Math.max(0, Math.min(width - w, cx - w / 2)), y = Math.max(0, Math.min(height - h, cy - h / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
