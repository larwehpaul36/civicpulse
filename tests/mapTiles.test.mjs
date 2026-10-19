import test from 'node:test';
import assert from 'node:assert/strict';
import { tileX, tileY, tileUrl, tilesInBounds, planOffline } from '../lib/mapTiles.js';

test('tile numbers match known map values', () => {
  assert.deepEqual([tileX(-0.1278, 10), tileY(51.5074, 10)], [511, 340]); // London, the standard reference tile
  assert.deepEqual([tileX(-0.187, 16), tileY(5.6037, 16)], [32733, 31746]); // Accra
  assert.deepEqual([tileX(-180, 0), tileY(0, 0)], [0, 0]);
  assert.equal(tileUrl(16, 32733, 31746), 'https://tile.openstreetmap.org/16/32733/31746.png'); // must match what Leaflet requests
});

test('a phone-sized street view needs only about twenty pictures, spread over three zooms', () => {
  const view = { south: 5.6010, west: -0.1904, north: 5.6065, east: -0.1838 };
  const plan = planOffline(view, 16);
  assert.deepEqual(plan.zooms, [15, 16, 17]);
  assert.equal(plan.tiles.length, 20);
  assert.equal(plan.tooWide, false);
  const key = (t) => `${t.z}/${t.x}/${t.y}`;
  assert.equal(new Set(plan.tiles.map(key)).size, plan.tiles.length, 'no duplicates');
  assert.ok(plan.tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x < 2 ** t.z && t.y < 2 ** t.z));
  assert.ok(plan.tiles.some((t) => t.z === 16 && t.x === 32733 && t.y === 31746), 'covers the centre');
});

test('too far out, or too big an area, asks the person to zoom in instead of downloading a lot', () => {
  const view = { south: 5.6010, west: -0.1904, north: 5.6065, east: -0.1838 };
  assert.equal(planOffline(view, 14).tooWide, true);
  assert.equal(planOffline(view, 13).tiles.length, 0);
  const huge = { south: 5.0, west: -1.0, north: 6.0, east: 0.0 };
  assert.equal(planOffline(huge, 16).tooWide, true);
});

test('the closest zoom is dropped first when the area is big, and the total never passes the cap', () => {
  const view = { south: 5.5990, west: -0.1950, north: 5.6090, east: -0.1830 }; // 4 + 9 + 25 = 38 pictures over zooms 15 to 17
  assert.equal(planOffline(view, 16, { max: 40 }).tiles.length, 38);
  const plan = planOffline(view, 16, { max: 30 });
  assert.deepEqual(plan.zooms, [15, 16]); // zoom 17 (25 pictures) dropped
  assert.equal(plan.tiles.length, 13);
  const tight = planOffline(view, 16, { max: 8 }); // only the widest zoom (4 pictures) fits
  assert.deepEqual([tight.zooms, tight.tiles.length, tight.tooWide], [[15], 4, false]);
  assert.equal(planOffline(view, 16, { max: 3 }).tooWide, true); // not even that fits: ask the person to zoom in
});
