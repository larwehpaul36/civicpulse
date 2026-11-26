# Office page (build 7)

Staff of an assembly or office sign in at `/office` and see only the reports sent to their office. They can reply in public.

## How it works
1. A moderator opens the **Office staff** tab on the moderator desk, types the staff member's email, picks the office, and presses Invite.
2. The tab shows a ready message (with the `/office` address) to copy or email to that person. CivicPulse does not send it for you.
3. The staff member opens `/office`, enters the same email, taps "Email me a sign-in link", and opens the link.
4. They see three tabs: **Waiting for your reply**, **You have replied**, **Fixed**. Each report shows the photo, the exact spot (Google Maps and OpenStreetMap links), what has been said, and a reply form.
5. A reply is public on the report page, marked "sent by the office, signed in", and the people following the report are told (same as other replies).

## What staff can and cannot do
- Can: see reports of their own office that are sent, in progress or fixed; reply (a message, a fix date, "not our responsibility").
- Cannot: change a status, add or remove photos, hide anything, see other offices, see rejected, duplicate or not-yet-sent reports, or list anyone's email.
- At most 10 people per office. At most 10 replies a day per person per report.

## Safety rules (migration 026)
- No self sign-up: access exists only for an email a moderator invited. The email must be confirmed, and an anonymous resident account never counts.
- Access is checked on every call. "Switch off" works at once.
- Staff emails are personal data: the table is private, only moderators can list it, and the page does not log.
- `/office` is not indexed by search engines and sends no referrer.

## Order of work
1. Supabase SQL editor: run `026_office_staff.sql` once (needs 021, 022 and 025). It is safe to run twice.
2. Optional check, expect `false, true, false, true`: the query at the bottom of the file.
3. Deploy the branch, test on a preview, merge.

## Test plan (use two emails you control)
1. Moderator desk, Office staff tab: invite email A for one office. Check the message appears.
2. Open `/office` in a private tab, sign in with email A. You should see that office's sent reports only.
3. Send a reply, then a fix date. Open the public report: both show, marked as from the office.
4. Sign in at `/office` with an email that was NOT invited: it should say it has not been invited.
5. On the moderator desk press Switch off for email A. Reload `/office`: it should show nothing.

## Known limits
- The preview sign-in needs the Turnstile fix (see the earlier note), or test on the live site.
- Invitations are not emailed by CivicPulse. A real invitation email needs an email provider later.
- Tests: `tests/officeStaff.test.mjs` and `tests/office_staff_stub_test.sql` (58 checks). Real Supabase sign-in and real phones are not covered.
