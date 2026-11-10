# "Is it fixed?" (migration 019)

When an office marks a report **resolved**, the person who reported it and the neighbours who confirmed it see three buttons on the report page: **Yes, fixed / Partly / No, not fixed**. Everyone sees the totals, never who answered.

## What happens
- Two people saying "partly" or "not fixed", outnumbering "fixed", **reopens** the report. If only the reporter ever took part, one answer is enough.
- A reopened report goes back to the responsible office (status *sent*, or *verified* if no office is set). Its **original sent date is kept**, so the waiting time keeps counting against the office on the tracker, and the tracker shows "Reopened N times" on that office's card.
- The reporter and confirmers get a "reopened" notice (in the app, and by push or email if they turned those on). The report's history records the reason (`reopened_by_neighbours`).
- It reopens by itself **at most twice** per report. After that answers are still recorded and shown, and a moderator decides. This limits what two people working together can do to an office.
- A person can change their answer until the report reopens. After the next resolution a fresh round begins.

## Set up
1. Run `019_fix_checks.sql` in the Supabase SQL editor (after 001-018). It is safe to run twice. Run its two CHECKS at the bottom. Then run `020_admin_fix_checks.sql`: it gives moderators the answer totals.
2. Redeploy the app. If you use the `notify` function, redeploy it too (`supabase functions deploy notify --no-verify-jwt`) so the push/email says "reopened".
3. `npm run check:live` has a new line for it.
4. Test once: resolve a test report in `/admin` (it needs an after photo), open it as the reporter, press **No, not fixed**. With no confirmers the report reopens at once. With confirmers, a second person must answer too.

## Changing the rules
The numbers are in `019_fix_checks.sql`, on the lines marked `RULE`: how many answers reopen it (2) and how many automatic reopenings are allowed (2). Edit and run the file again.

## Not verified
Tested on a stand-in Postgres (no PostGIS, no Supabase) and in Node. The screen, the real status trigger and the notification delivery have not been run against a live project. 

## For moderators
`/admin` has a **Disputed fixes** tab: reports where neighbours doubt the fix, or that were reopened before. Each card shows the totals ("2 fixed, 1 partly, 0 not fixed") and how many times it was reopened. Totals only: you never see who answered. For a reopened report, check that the right office is assigned and change it in the card if not. When a report has used up its two automatic reopenings and neighbours still say it is not fixed, the card says so and you decide: set it back to *sent*, or leave it resolved. Reopening by hand needs no after photo.
