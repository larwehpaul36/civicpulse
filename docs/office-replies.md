# Office right of reply (021)

**What it is.** An office can answer a report in public: a short reply (500 characters), an expected fix date, or "this is not our responsibility". The report page shows it under "What the office said", marked "Relayed by CivicPulse". If the date passes and the report is not fixed, the page says so.

**First version: moderators relay.** Offices do not sign in. When an office answers by WhatsApp, a call or a visit, a moderator opens the case in `/admin`, finds **Office reply (shown publicly)**, and records it. This was chosen because it needs no new sign-in or email setup. A later version can let an office sign in with an emailed link (needs the SMTP setup in `email-signin-setup.md`).

**Rules (in the database)**
- Only moderators add replies. A report must have a responsible party assigned.
- Replies are never edited. A mistake or abuse is **hidden** (the moderator sees it marked hidden; the public no longer sees it).
- The public never sees which moderator relayed a reply.
- A reply cannot resolve a report. Resolving still needs a moderator and an after photo.
- "Not our responsibility" is only a note. A moderator then changes the responsible party by hand.

**Set up**
1. Merge the app change and let Vercel deploy it (the page works without 021: it just shows nothing).
2. Supabase SQL editor: run `021_office_replies.sql`. Safe to run twice.
3. `npm run check:live`: the 021 line should pass.
4. In `/admin`, open a case that has a party, publish a test reply, then open the public report page. Hide it afterwards.

**Not done:** notifying followers when an office replies (the existing notifications trigger watches status changes only); showing "expected date vs actual fix" on the tracker; office sign-in.
