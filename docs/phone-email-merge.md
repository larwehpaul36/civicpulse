# Phone and email account merge (migration 024)

Fixes "gap 1" from HANDOVER. It matters only once phone verification is on (011b). Until then nothing changes for anyone.

## What was wrong
1. A phone that verified a number, then signed in to an email account, brought its reports along but left the verified number
   behind. The email account stayed unverified and the same number could be refused as "already used".
2. A phone whose number already belonged to another account was signed in to that account, and its own reports were left behind.
3. Supabase may set `is_anonymous` to false after a phone is linked, and the merge accepted only accounts still flagged anonymous.

## What 024 does
- "Old account" now means "no confirmed email" (an anonymous account qualifies, as before).
- "New account" may be proved by a confirmed email OR a confirmed phone number.
- A confirmed number moves with the reports when the new account has none. If it already has its own, it keeps it.
- Everything else (once-only 24-hour ticket, kept as a fingerprint, same permissions) is unchanged.

## In the app
- `lib/verifyFlow.js`: when a number already belongs to an account, a ticket is made BEFORE signing in to it, and handed over
  right after the code is confirmed. Best effort: a failure never blocks the sign-in. `confirmCode` returns `{ ok: true, moved }`.
- `lib/mergeTicket.js`: tickets can be tied to a phone number as well as an email; the account signed in to must match.
- Without 024, the database refuses the hand-over, the ticket is kept, and sign-in behaves exactly as before.

## Running it
Supabase SQL editor, after 017 (safe to run twice). It does not switch the phone rules on. CHECKS A and B at the bottom of the
file print the permissions (f, t, f, t) and two `true` values. Tests: `tests/hardening_stub_test.sql` (139 checks, 18 are new),
`tests/mergeTicket.test.mjs`, `tests/verifyFlow.test.mjs`.

## Not verified on a live project
Whether Supabase's `auth.users.phone` accepts being set to null in the way the function does it (the tests use a stand-in table),
and what `is_anonymous` becomes after a phone is linked. Check on a test account before relying on it. A person who is signed in to
a phone-verified account on a SHARED phone and then signs in to someone else's email could move the first person's reports
(the same exposure that already exists for anonymous phones).
