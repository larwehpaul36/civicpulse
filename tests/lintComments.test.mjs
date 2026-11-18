import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The project's linter has only the accessibility plugin. A comment that switches off a rule from a plugin that is
// not installed (for example react-hooks) makes `npm run lint:a11y` fail with "Definition for rule ... was not found".
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(n) ? [p] : [];
});

test('no source file disables a lint rule the project does not have', () => {
  const bad = [];
  for (const dir of ['app', 'components']) {
    for (const f of walk(join(root, dir))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/eslint-disable[^\n]*react-hooks\//.test(line)) bad.push(`${f.slice(root.length)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(bad, [], `remove these comments (the react-hooks plugin is not installed): ${bad.join(', ')}`);
});
