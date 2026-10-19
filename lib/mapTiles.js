// Which map pictures (tiles) cover a map view. Standard web-map maths (the "slippy map" scheme OpenStreetMap uses).
export const tileUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const clampLat = (lat) => Math.max(-85.0511, Math.min(85.0511, lat));
export const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
export const tileY = (lat, z) => {
  const r = (clampLat(lat) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// bounds: { south, west, north, east }
export function tilesInBounds(b, z) {
  const max = 2 ** z - 1;
  const x0 = Math.max(0, tileX(b.west, z)), x1 = Math.min(max, tileX(b.east, z));
  const y0 = Math.max(0, tileY(b.north, z)), y1 = Math.min(max, tileY(b.south, z));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

// What to save for the part of the map on screen: this zoom, one wider and one closer.
// Stays small on purpose (OpenStreetMap's servers are free and shared): at most `max` pictures.
// Returns tooWide when the person should zoom in to street level first.
export function planOffline(bounds, zoom, { max = 90, minZoom = 15, maxZoom = 18 } = {}) {
  if (zoom < minZoom) return { tiles: [], zooms: [], tooWide: true };
  let zooms = [...new Set([zoom - 1, zoom, zoom + 1].map((z) => Math.min(maxZoom, Math.max(minZoom - 1, z))))].sort((a, b) => a - b);
  const build = () => zooms.flatMap((z) => tilesInBounds(bounds, z));
  let tiles = build();
  while (tiles.length > max && zooms.length > 1) { zooms = zooms.slice(0, -1); tiles = build(); } // drop the closest zoom first
  if (tiles.length > max) return { tiles: [], zooms: [], tooWide: true };
  return { tiles, zooms, tooWide: false };
}
