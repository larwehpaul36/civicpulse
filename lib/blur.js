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
