import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryTitle } from '../lib/categoryTitle.js';

test('category title adds the reporter\'s words only when there are some', () => {
  assert.equal(categoryTitle('Other problem', 'Fallen tree'), 'Other problem: Fallen tree');
  assert.equal(categoryTitle('Pothole', null), 'Pothole');
  assert.equal(categoryTitle('Pothole', undefined), 'Pothole');
  assert.equal(categoryTitle('Pothole', ''), 'Pothole');
});
