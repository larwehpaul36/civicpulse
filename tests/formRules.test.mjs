import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directoryMissing, replyMissing, emailProblem } from '../lib/formRules.js';
import { checkReply } from '../lib/officeReplies.js';

const blank = { name: '', type: '', regionId: '', note: '' };

test('a new office needs a name, a type, an area and at least one problem type', () => {
  assert.deepEqual(directoryMissing('new_party', blank, 0), ['name', 'type', 'area', 'problems']);
  assert.deepEqual(directoryMissing('new_party', { name: 'Accra Water', type: 'utility', regionId: 'r' }, 2), []);
});

test('a name is 2 to 120 characters, ignoring spaces', () => {
  const ok = { ...blank, type: 't', regionId: 'r' };
  assert.deepEqual(directoryMissing('new_party', { ...ok, name: ' a ' }, 1), ['name']);
  assert.deepEqual(directoryMissing('new_party', { ...ok, name: 'ab' }, 1), []);
  assert.deepEqual(directoryMissing('new_party', { ...ok, name: 'x'.repeat(121) }, 1), ['name']);
});

test('adding coverage needs an area and a problem type, nothing else', () => {
  assert.deepEqual(directoryMissing('coverage', blank, 0), ['area', 'problems']);
  assert.deepEqual(directoryMissing('coverage', { ...blank, regionId: 'r' }, 0), ['problems']);
});

test('"this entry is wrong" needs a note of at least 5 characters; a correction needs nothing here', () => {
  assert.deepEqual(directoryMissing('wrong', blank, 0), ['note']);
  assert.deepEqual(directoryMissing('wrong', { ...blank, note: '  no  ' }, 0), ['note']);
  assert.deepEqual(directoryMissing('wrong', { ...blank, note: 'closed down' }, 0), []);
  assert.deepEqual(directoryMissing('correction', blank, 0), []);
});

test('office reply: an expected date needs the date, anything else needs the words', () => {
  assert.deepEqual(replyMissing('expected_date', { body: '', expected: '' }), ['date']);
  assert.deepEqual(replyMissing('expected_date', { body: '', expected: '2026-12-01' }), []);
  assert.deepEqual(replyMissing('reply', { body: '  ', expected: '' }), ['text']);
  assert.deepEqual(replyMissing('not_ours', { body: 'Not ours', expected: '' }), []);
});

test('the reply form agrees with the database rules in checkReply', () => {
  const today = '2026-11-18';
  for (const [kind, body, expected] of [['expected_date', '', ''], ['expected_date', '', '2026-12-01'], ['reply', '', ''], ['reply', 'x', ''], ['not_ours', '', ''], ['not_ours', 'x', '']]) {
    const formSaysMissing = replyMissing(kind, { body, expected }).length > 0;
    const ruleSaysMissing = ['date_required', 'text_required'].includes(checkReply({ kind, body, expected }, today));
    assert.equal(formSaysMissing, ruleSaysMissing, `${kind} / "${body}" / "${expected}"`);
  }
});

test('an email box is empty, wrong, or fine', () => {
  assert.equal(emailProblem(''), 'empty');
  assert.equal(emailProblem('   '), 'empty');
  assert.equal(emailProblem('kofi@'), 'bad');
  assert.equal(emailProblem('kofi mensah@mail.com'), 'bad');
  assert.equal(emailProblem(' Kofi@Mail.com '), null);
});

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('the forms use our own messages, not the browser pop-ups, and no button is silently greyed out', () => {
  for (const f of ['../components/DirectoryForm.js', '../components/KeepAccount.js', '../components/NotificationSettings.js']) {
    const src = read(f);
    assert.ok(src.includes('noValidate'), `${f} must turn off the browser's own pop-ups`);
    assert.ok(!/[^-]required[=\s>}]/.test(src.replace(/aria-required/g, '')), `${f} still has a native required attribute`);
    assert.ok(!/disabled=\{[^}]*!email\.trim\(\)|disabled=\{[^}]*!signInEmail\.trim\(\)|!agree \|\|/.test(src), `${f} still greys out its button for an empty box`);
  }
});

test('required fields in the directory and reply forms carry the star and a message', () => {
  const dir = read('../components/DirectoryForm.js');
  for (const k of ['name', 'type', 'area', 'problems', 'note']) assert.ok(dir.includes(`fix('${k}')`), `directory: no message for ${k}`);
  assert.ok((dir.match(/<Req \/>/g) || []).length >= 5);
  const rep = read('../components/AdminReplyForm.js');
  for (const k of ['date', 'text']) assert.ok(rep.includes(`fix('${k}')`), `reply: no message for ${k}`);
});
