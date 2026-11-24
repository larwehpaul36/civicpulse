// Links that open a report's saved spot in a map. Both links carry the SAME
// numbers (latitude, longitude), so the pin lands on the same spot either way.
// A missing or impossible location gives null, never a broken link.
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

export function coords(lat, lng) {
  const a = num(lat), b = num(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null; // "null island": almost always a missing value
  return { lat: a.toFixed(6), lng: b.toFixed(6) };
}

// Google's documented "search" URL format.
export function googleMapsUrl(lat, lng) {
  const c = coords(lat, lng);
  return c && `https://www.google.com/maps/search/?api=1&query=${c.lat}%2C${c.lng}`;
}

export function osmUrl(lat, lng) {
  const c = coords(lat, lng);
  return c && `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=18/${c.lat}/${c.lng}`;
}

export const coordsText = (lat, lng) => {
  const c = coords(lat, lng);
  return c && `${c.lat}, ${c.lng}`;
};
