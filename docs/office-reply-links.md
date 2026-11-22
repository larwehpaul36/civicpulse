# Office reply links (migration 025)

A moderator sends a case to an office by WhatsApp or email (the prepared message in /admin). Before pressing those buttons the
moderator presses **Add a reply link to the message**. The message then ends with a private link. The officer opens it, chooses
"a reply", "the date it will be fixed" or "not our responsibility", writes a short message and presses Publish. No sign-in.

What happens next: the reply appears at once on the public report, marked "Sent by the office through a private reply link. Not
verified." The people following the report are notified (the trigger from 022). The tracker counts it as a reply (lib/trackerStats.js).

## Safety
- The link holds a 64-character random secret. Only its SHA-256 hash is stored.
- One report per link. Expires after 30 days (moderator can pick 1 to 60 in code). The moderator keeps the 5 newest links per report; older ones stop.
- 5 link replies per report per day. A wrong, expired, revoked or rejected-report link all say the same thing: "link_invalid".
- "Switch off this report's reply links" revokes every live link for a report.
- Moderators can still hide any reply (existing Hide button).
- Anyone holding the link can reply. It proves possession of a link, not who someone is. Do not call these replies verified.
- The page is not indexed, sends no Referer, and never logs (the address holds the secret). Vercel's own request logs can still show the address.

## Order of work
1. Merge the code. It is safe before the migration: replies still load (the page retries without the new column), and the admin
   button says to run 025.
2. Run `025_office_reply_links.sql` in the Supabase SQL editor (touches the live database; safe to run twice). Needs 021 and 022.
3. Test on a real phone: make a link in /admin for a report that has an office, open it in a private tab, reply, check the public report.

## Tests
`tests/reply_links_stub_test.sql` (44 checks, picked up by `scripts/run-sql-tests.sh` and the CI "sql" job), `tests/replyLinks.test.mjs`.
Not covered: a real Supabase project, and a real WhatsApp or email client.
