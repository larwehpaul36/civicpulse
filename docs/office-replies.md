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

**Followers are told (022).** When a reply is recorded, the reporter and everyone who confirmed the report get an update on `/my`, and a push or email if they switched those on (same `notify` function and webhook as status changes; nothing new to set up). The notice says only that the office replied, gave a date, or says it is not its job. It never contains the reply text, because push messages show on lock screens. Someone who still has an unread notice of the same kind for that report is not sent another. Run `022_office_reply_notices.sql` after 021. **Also redeploy the `notify` function** (`supabase functions deploy notify`) so the new wording is used; until then the feed works but push and email ignore these notices. Check: after a test reply, `select user_id, to_status from notifications where to_status like 'office_%' order by created_at desc limit 5;`.

**Not done:** showing "expected date vs actual fix" on the tracker; office sign-in.
