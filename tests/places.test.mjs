import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabel, districtsOf, regionOf, placeChain, officesNear } from '../lib/places.js';

const regions = [
  { id: 'g1', name: 'Ashanti', level: 'region', parent_id: null },
  { id: 'g2', name: 'Volta', level: 'region', parent_id: null },
  { id: 'a2', name: 'Kumasi Metropolitan', level: 'area', parent_id: 'g1' },
  { id: 'a1', name: 'Ejisu Municipal', level: 'area', parent_id: 'g1' },
  { id: 'a3', name: 'Ho Municipal', level: 'area', parent_id: 'g2' },
  { id: 'c1', name: 'Kumasi', level: 'city', parent_id: 'g1' },
];
const byId = Object.fromEntries(regions.map((r) => [r.id, r]));

test('a place is named with its region, except regions themselves', () => {
  assert.equal(placeLabel(byId.g1, byId), 'Ashanti');
  assert.equal(placeLabel(byId.a2, byId), 'Kumasi Metropolitan, Ashanti');
  assert.equal(placeLabel(byId.c1, byId), 'Kumasi, Ashanti');
  assert.equal(placeLabel({ id: 'x', name: 'Lost', level: 'area', parent_id: 'nope' }, byId), 'Lost');
});

test('a region offers only its own districts, in alphabetical order, never cities', () => {
  assert.deepEqual(districtsOf(regions, 'g1').map((r) => r.name), ['Ejisu Municipal', 'Kumasi Metropolitan']);
  assert.deepEqual(districtsOf(regions, 'g2').map((r) => r.name), ['Ho Municipal']);
  assert.deepEqual(districtsOf(regions, 'nope'), []);
});

test('the region of any chosen place is found, so the first dropdown can show it', () => {
  assert.equal(regionOf(byId.g1), 'g1');
  assert.equal(regionOf(byId.a2), 'g1');
  assert.equal(regionOf(byId.c1), 'g1');
  assert.equal(regionOf(undefined), '');
});

test('the chain from a district goes up through its region, and never loops', () => {
  assert.deepEqual(placeChain('a2', byId), ['a2', 'g1']);
  assert.deepEqual(placeChain('g1', byId), ['g1']);
  assert.deepEqual(placeChain('nope', byId), []);
  const loop = { x: { id: 'x', parent_id: 'y' }, y: { id: 'y', parent_id: 'x' } };
  assert.deepEqual(placeChain('x', loop), ['x', 'y']);
});

test('a report sees the offices near it first: its district, its region, national ones, and districts inside a region', () => {
  const parties = [
    { id: 'p1', name: 'Kumasi Metropolitan Assembly', region_id: 'a2' },
    { id: 'p2', name: 'Ejisu Municipal Assembly', region_id: 'a1' },
    { id: 'p3', name: 'Ho Municipal Assembly', region_id: 'a3' },
    { id: 'p4', name: 'Ashanti Regional Office', region_id: 'g1' },
    { id: 'p5', name: 'National Agency', region_id: null },
  ];
  const names = (placeId) => officesNear(parties, regions, placeId).map((p) => p.name);
  assert.deepEqual(names('a2'), ['Kumasi Metropolitan Assembly', 'Ashanti Regional Office', 'National Agency']);
  assert.deepEqual(names('g1'), ['Kumasi Metropolitan Assembly', 'Ejisu Municipal Assembly', 'Ashanti Regional Office', 'National Agency']);
  assert.deepEqual(names('a3'), ['Ho Municipal Assembly', 'National Agency']);
});

