// Required-field rules for the forms other than the report form (that one lives in reportRules.js).
// Each function returns the keys of what is still missing, in the order the fields appear on screen.
import { cleanEmail, looksLikeEmail } from './emailAccount.js';

// "Suggest an office / correct an entry". The four kinds of suggestion need different things.
//   new_party: name, type, area, at least one problem type   coverage: area and a problem type
//   wrong: a note saying what is wrong                         correction: nothing is required, but the server wants one change
export function directoryMissing(mode, { name, type, regionId, note }, pickedCount) {
  const m = [];
  const len = String(name ?? '').trim().length;
  if (mode === 'new_party') {
    if (len < 2 || len > 120) m.push('name');
    if (!type) m.push('type');
  }
  if (mode === 'new_party' || mode === 'coverage') {
    if (!regionId) m.push('area');
    if (!pickedCount) m.push('problems');
  }
  if (mode === 'wrong' && String(note ?? '').trim().length < 5) m.push('note');
  return m;
}

// The moderator's "office reply" form. An expected date needs the date (the words are optional);
// a reply or "not our job" needs the words. This matches checkReply() in officeReplies.js.
export function replyMissing(kind, { body, expected }) {
  if (kind === 'expected_date') return expected ? [] : ['date'];
  return String(body ?? '').trim() ? [] : ['text'];
}

// A single email box: empty, written wrongly, or fine.
export function emailProblem(value) {
  const v = cleanEmail(value);
  if (!v) return 'empty';
  return looksLikeEmail(v) ? null : 'bad';
}
