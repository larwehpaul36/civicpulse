# CivicPulse: handover note

Last updated: 16 Oct 2026 (phase 7 added: community directory and two security fixes; phase 6 notifications; phase 5 related-report linking; phase 4 the offline queue). Paste the "Prompt for the new chat" section (bottom) into a new chat, and attach this file plus the SQL files (001-008).

## What this is
A civic accountability app for any local neighborhood problem (waste, choked gutters, streetlights, potholes, later water and safety). Residents report with a photo and location. The core feature, not yet built, is a public tracker showing whether and how fast each case gets fixed, so visibility pressures the responsible party. Built by an IT student in Ghana, inspired by the phrase "Remember the power we hold to change the world as we see fit." Intended to work nationwide and in other countries later.

## Decisions already made
- Stack: Next.js 16 + React 19 (JavaScript, app router; needs Node 20.9 or newer), Supabase (Postgres + PostGIS, storage, anonymous auth), Leaflet + OpenStreetMap, Vercel hosting.
- Design for many regions and categories from day one, launch with 3-4 categories in one area.
- Categories, regions, and "who is responsible for what, where" are data, not code.
- Web form first. WhatsApp is phase two.
- No AI at first. Duplicates = same category within 50 m.
- No blockchain. Tamper-evidence comes from the append-only `status_log` and `contact_attempts`.
- A case becomes "verified" after 3 independent confirmations.
- Exact locations are private. Public views show rounded locations.
- All interface text lives in `lib/strings.js`.
- Directory: the community SUGGESTS, moderators APPROVE; nobody edits the live directory directly, because escalation messages carry the exact location and a changed phone number would redirect them. The public sees names, types, areas and what each party handles, never contact details.
- Notifications: in-app updates first, web push second, optional email third. Followers of a report are its reporter plus everyone who confirmed it. Email is off by default (`NEXT_PUBLIC_EMAIL_NOTICES`), needs a mail provider and a review of the privacy wording, and only ever goes to an address its owner has verified. No phone/SMS yet (needs a provider choice: Hubtel, mNotify or similar).
- Queue-first reporting: every report is saved on the phone (IndexedDB) first and then sent, so a weak signal cannot lose it. The client generates the report id, so retries are safe.

## Files
SQL (run in the Supabase SQL editor, in this order):
1. `001_civicpulse_schema.sql`: tables, triggers, views, seed categories, Ghana country + Greater Accra + Accra.
2. `002_ghana_regions.sql`: all 16 Ghana regions and 9 regional capitals.
3. `003_security_and_storage.sql`: fixes security holes in 001 (RLS on all tables, hidden exact location, locked-down issue writes, safe duplicate check) and creates the `issue-photos` bucket.
4. `004_region_matching_and_public_view.sql`: responsible-party matching now walks up the region tree (city, region, country); `public_issues` view now returns rounded `lat`/`lng`; has commented dev helpers to add a party and move a case to sent/resolved.
5. `005_moderators.sql`: `moderators` table and admin functions (list issues with exact location, set status, assign party, log contact, add after photo, dismiss flags, add party). Rules enforced in the database: "sent" needs a responsible party, "resolved" needs an after photo. Bottom of the file has the line that makes you a moderator.
6. `006_issue_links.sql` (in the project root): `admin_link_issues(p_a, p_b, p_relation)` and `admin_unlink_issues(p_a, p_b)`, both moderator-only. Relations are `related` or `duplicate` (same problem reported twice). One row per pair (smaller id first), so linking in either order gives the same row. The `issue_links` table itself is unchanged and stays read-only for everyone.
7. `007_notifications.sql` (project root): tables `notifications`, `push_subscriptions`, `notification_contacts`; a trigger on `status_log` that adds one notification per follower for every status change after `reported` (and never blocks the status change if it fails); functions `my_reports`, `mark_notifications_read`, `save_push_subscription`, `remove_push_subscription`, `set_notification_contact`, `my_notification_contact`, `clear_notification_contact`, `confirm_notification_email`, `unsubscribe_contact`. Nothing is writable directly. Needs `status_log(issue_id, to_status)`, `issues.reporter_id`, `confirmations(issue_id, user_id)` and the `public_issues` view, all from 001-005.
8. `008_directory.sql` (project root). Part 1 fixes two gaps found in the live database: `responsible_parties` was readable in full by anyone (email, phone, WhatsApp, notes) and the `"suggest party"` policy let anyone insert parties, which then showed in the moderator's party list. Now the public can read only `id, name, type, region_id, verified, created_at`, direct writes are removed, and the moderator list shows verified parties only. Part 2 adds `directory_suggestions` and four functions: `suggest_directory_change` (kinds `new_party`, `correction`, `coverage`, `wrong`; 3 waiting and 5 per day per account), `my_directory_suggestions`, `admin_list_suggestions`, `admin_review_suggestion` (approve applies the change; approving `wrong` makes the party unverified and removes its automatic matches; contact details are wiped from the suggestion afterwards).

Project (`civicpulse/`):
- `app/page.js`, `layout.js`, `globals.css`: single page showing the report form. Design: system fonts (no downloads on slow connections), ink green + road-sign yellow, large tap targets.
- `components/ReportForm.js`: category/region/severity pickers, photo, map, duplicate check, upload, insert, confirm-existing flow.
- `components/LocationPicker.js`: Leaflet map, tap to mark, "Use my location".
- `app/issues/page.js`: map + filterable list of all reports. `app/issues/[id]/page.js`: one report with before/after photos, status history, contact log, "I can see this too" and flag buttons. `app/tracker/page.js`: totals and per-party ranking by average days to resolve, grouped by category.
- `components/IssuesMap.js`, `components/Nav.js`, `lib/status.js`.
- `app/admin/page.js` + `components/AdminIssue.js`: moderator desk at `/admin` (not linked from the nav, not indexed). Magic-link email sign-in, tabs (needs action / with responsible party / flagged / resolved / rejected), per-case panel: assign party, escalation message (WhatsApp, email, or copy), mark sent / in progress / resolved (with after photo) / rejected, log contact outcome, dismiss flags; plus an "add responsible party" form.
- `lib/supabase.js` (client + anonymous sign-in), `compressImage.js` (resize to 1280 px, JPEG 0.7), `i18n.js`, `strings.js`.
- Phase 4 (offline): `lib/offlineQueue.js` (IndexedDB outbox), `lib/syncQueue.js` (sends queued reports step by step with retries; dependencies injected so it is testable), `lib/sync.js` (wires it to the real Supabase client), `lib/useOutbox.js` (React hook), `lib/refData.js` (keeps categories and regions on the phone), `components/SyncBanner.js` (registers the service worker, triggers syncing, shows waiting/failed reports), `public/sw.js` (service worker), `app/offline/page.js`, `app/manifest.js` + `public/icons/` (add to home screen). `ReportForm.js` now saves first, then sends.
- Phase 5 (related reports): `lib/relatedIssues.js` (distance, id parsing, nearby-match suggestions). Admin desk: each case has a "Related reports" section with linked reports (open or unlink), suggested matches (same category, within 150 m, not rejected, not yet linked, nearest first), a "Link as: same problem / related problem" choice, and a box to link by report ID or page address. Public report page: a "Related reports" list that links to each one.
- Phase 6 (notifications): `app/my/page.js` ("My reports": reports waiting on this phone, sent reports with an "Updated" mark, a feed of updates with "New" marks), `components/MyReportsLink.js` (nav link with unread count), `components/NotificationSettings.js` (push switch; email form when enabled), `components/TokenAction.js` with `app/confirm-email` and `app/unsubscribe` (act only when the button is pressed, so mail scanners cannot trigger them), `lib/notifications.js`, `lib/pushHelpers.js`, push handling in `public/sw.js`, and the sender `supabase/functions/notify/` (`core.js` logic, `index.ts` Deno wiring, `README.md` setup steps). The saved-report screen links to My reports.
- Phase 7 (directory): `app/directory/page.js` (public "Who fixes what": search, parties with what they handle and where, "suggest a change" per party, "suggest a missing party", your own suggestions and their outcome), `components/DirectoryForm.js` (one form for all four kinds), `components/AdminSuggestion.js` and a "Directory" tab in `/admin` (each suggestion with the proposed change beside the current entry, contacts visible to moderators only, approve or reject with a reason), `lib/directory.js`, `lib/directoryApi.js`, nav link.
- Tests (`npm test`, 46 checks): `tests/syncQueue.test.mjs` (queue and sync logic against a stand-in Supabase), `tests/sw.test.mjs` (service worker caching rules with a fake Cache API), `tests/relatedIssues.test.mjs`, `tests/directory.test.mjs`, `tests/notifyCore.test.mjs` (the sender's logic with fake push/email/database), `tests/pushHelpers.test.mjs`, `tests/helpers/swHarness.mjs`. `tests/issue_links_stub_test.sql` and `tests/notifications_stub_test.sql` and `tests/directory_stub_test.sql` are separate: each runs a migration against a throwaway Postgres (instructions in their first lines).

## Setup
1. Create a Supabase project. Run the three SQL files in order.
2. Authentication > enable anonymous sign-ins.
3. Copy `.env.local.example` to `.env.local` and add the project URL and anon key.
4. `npm install` then `npm run dev` (open on localhost or HTTPS; `crypto.randomUUID` and geolocation need a secure context).
5. Run `006_issue_links.sql`, `007_notifications.sql` and `008_directory.sql` after the first five. 008 changes who can read the party tables, so afterwards open `/directory` and `/admin` and confirm both still load, then follow the security check under Known issues.. For push and email, follow `supabase/functions/notify/README.md` (keys, secrets, deploy, two Database Webhooks); the in-app updates on `/my` work without it.
 To test offline behavior, the service worker only runs in a production build: `npm run build && npm start`. In `npm run dev` it is switched off (and any old one is removed). Service workers also need HTTPS or localhost.

## Status
DONE (written, NOT yet run against a live Supabase project, so expect small errors on first run):
- Schema, region seed, security fixes, photo bucket
- Report form with compression, GPS or map pin, duplicate check, confirm-instead-of-duplicate
- Phase 2: map + list with filters, report page with confirm and flag, public tracker, region-tree matching. `next build` passes (syntax and routes checked); still not tested against live Supabase data.

- Phase 3: moderator role, admin desk, escalation message generator (WhatsApp / email / copy), party assignment that remembers per category and area, flag review (dismiss or reject). `next build` passes; not tested against live Supabase or a real sign-in email.
- Phase 4: offline queue. Reports are saved in IndexedDB, then sent with per-step progress (photo upload, issue row, photo row), so a dropped connection resumes instead of restarting. "Already exists" answers count as success. Real rejections back off (15 s, 30 s, ... 10 min) and are marked failed after 5 tries; failed reports show a Try again / Delete notice. Syncing runs on page load, when the connection returns, when the tab becomes visible, every 30 s, and from a "Send now" button. Service worker: the report form opens with no signal, other pages show an offline page, scripts (including the lazily loaded map) and viewed map tiles are kept, `/admin`, Supabase calls and non-GET requests are never touched. Categories and regions are cached so the form's pickers work offline. `npm test` passes 21 checks, `next build` passes, and the worker was run against the real production build in a Node sandbox (installs, saves the map chunk, serves the form, the offline page and all 13 saved files with the network cut). NOT tested: a real browser installing the worker, real Supabase writes from the queue, or a phone losing signal mid-upload.
- Phase 5: related-report linking. 006 was run on a real PostgreSQL 16 with stand-ins for the tables it touches: moderators only, either id order gives one row, relinking changes the relation, bad input gives clear errors (`same_issue`, `bad_relation`, `issue_not_found`), anonymous users can read links but cannot call the functions or write directly. The admin panel was rendered server-side with sample data and shows linked reports, suggestions with distances, and does not re-suggest a linked report. `next build` passes. NOT tested: 006 on your live Supabase, the admin panel and public page in a browser, or against the real `public_issues` view (the public list asks it for `id, category_id, status, description, days_open`).
- Phase 6: notifications. 007 was run on a real PostgreSQL 16 with stand-ins for the tables it touches: the trigger notifies the reporter and each confirmer once (nothing for `reported`), people see only their own notifications, a broken notification step never blocks a status change, subscriptions are validated and capped at five per account, emails are validated and rate-limited (one change per 10 minutes), the verify and unsubscribe tokens never reach the app, and anonymous visitors can use only the two token links. The sender's logic, the push handlers in the service worker and the push helpers have unit tests, and the My reports page was rendered in a simulated browser with sample data (Updated/New marks, push and email sections). `next build` passes. NOT tested: 007 on your live Supabase, a real push reaching a phone, the Deno function itself (`npm:web-push` under Supabase's runtime), the Resend email call, the two Database Webhooks, or any of it in a real browser.
- Phase 7: directory. 008 was run on a real PostgreSQL 16 with stand-ins that include the two old policies: before it, an anonymous user could read contacts and insert a party; after it, both are refused, the safe columns still read, and all of these pass: validation of every kind, duplicate-party refusal, the waiting and daily limits, moderator-only listing and review, approve applying each kind (new party with its problem types, partial correction, coverage without duplicates, wrong unverifying and unmatching), reject changing nothing, contact details wiped after review, no double review, people seeing only their own suggestions. The directory page, the suggestion form (all kinds, error messages) and the moderator card were exercised in a simulated browser with sample data. `next build` passes. NOT tested: 008 on your live Supabase (it changes permissions on two live tables; see the check below), or any of it in a real browser.
- SQL verification: the first live run failed on a wrong PostGIS function name (`st_snapmetogrid`, fixed to `st_snaptogrid` in 001 and 004). After the fix, all five SQL files were run against a real PostgreSQL 16 + PostGIS with Supabase stand-ins, and a 15-check smoke test passed (privacy, permissions, party auto-assignment, verification at 3 confirmations, moderator evidence rules, tracker view). Files: `tests/supabase_stubs.sql`, `tests/schema_smoke_test.sql`. This does not cover Supabase-specific behavior (real auth, storage uploads, email links) or the front end against live data.

NOT BUILT:
1. SMS / WhatsApp notices to reporters (needs a provider and phone-number validation)
2. README and deployment to Vercel (deployment is deliberately last)

## Known issues and caveats
- Dependency upgrade: the first version used Next.js 14.2.15, which npm flagged as vulnerable; even the last 14.x release still had open advisories. The project now uses Next.js 16.4.2 + React 19.3.1 (`npm audit`: 0 vulnerabilities; production build and all routes checked). Run `npm audit` again before deploying.
- Untested end to end. First run may need fixes to SQL or JS.
- `category_responsibilities` is empty, so new issues get no responsible party until rows are added (see the dev helpers at the bottom of 004). Matching now walks up the region tree, so one row for "Greater Accra" covers every city inside it.
- The tracker stays empty until at least one case is marked `sent` (which needs a responsible party and moderator action).
- Anonymous sign-ins are cheap to create, so the 3-confirmation rule can be gamed. Review cases manually before escalating. Consider phone-number login later.
- Users cannot read exact `location` or `public_location` from the `issues` table by design. Read locations through the `public_issues` view.
- Issue updates are blocked for users on purpose. Status changes currently happen from the Supabase dashboard or service role.
- Photos are in a public bucket. Privacy depends on users avoiding faces and house numbers. Consider face blurring later.
- Public OpenStreetMap tiles are fine for development. Heavy traffic needs a tile provider or your own server.
- Privacy laws differ by country (Ghana has a Data Protection Act). Collect minimal personal data and review before launch.

- Security fix in 008, and what to check: before it, anyone with your public key could read every party's email, phone, WhatsApp and notes, and add parties directly. After running 008, in the SQL editor run `select id, name, type, verified, created_by from responsible_parties where verified = false;` and delete or review anything you did not add (parties added through `admin_add_party` are verified). If you stored private individuals' numbers, treat them as possibly seen. 008 also changes table permissions: if a view or function of yours selected the contact columns as the calling user (not as its owner) it would now be refused; the app itself only reads the safe columns.
- Directory limits: suggestions are limited per anonymous account (3 waiting, 5 a day), but anonymous accounts are cheap, so a determined person can still fill the moderators' queue; add a CAPTCHA before heavy public use. The public page lists only verified parties, shows no search filter by area yet (only text search), and has no history of who changed what beyond `created_by` and the suggestion rows.
- Notifications reach people only through their anonymous account, which lives in one browser. Clearing site data, or using another phone, loses the list and the push registration (phone-number login would fix this). Push needs HTTPS and a production build; on iPhones it works only after CivicPulse is added to the Home Screen. The push and email text is English only and lives in `supabase/functions/notify/core.js` as well as `lib/strings.js`; change both.
- Email abuse limits: an address must be confirmed before anything is sent, one account can change its address once per 10 minutes, and every email carries a one-click stop link. Someone could still use many anonymous accounts to send confirmation emails to a stranger; add a CAPTCHA (for example Cloudflare Turnstile) before turning email on for the public. Review the consent and privacy wording in `lib/strings.js` (`email.consent`, `email.privacy`) against the Ghana Data Protection Act before enabling `NEXT_PUBLIC_EMAIL_NOTICES`.
- Followers are the reporter and anyone who confirmed ("I can see this too"); there is no way yet to follow a report without confirming it. Updates are sent for every status after `reported`, including `rejected`.
- Linking does not merge anything: linked reports keep their own confirmations, status and photos, and the tracker still counts each report separately, so a duplicate can inflate totals until a moderator rejects it. Only moderators can link. Suggestions are computed in the browser from the moderator's loaded list (exact locations never reach the public).
- Offline queue limits: queued reports send only while the app is open (page load, tab visible, or the 30 s timer). There is no background sync, because it is Chromium-only and needs sign-in tokens inside the worker. A report made offline waits until the person next opens CivicPulse with signal.
- First use needs signal once: the app, categories and regions must have been loaded online at least once, and the anonymous sign-in happens at send time. If a phone has never opened CivicPulse online, it cannot report offline.
- Offline reports skip the "similar reports" check (it needs the server), and it is not re-run when they send. Moderators should watch for duplicates from offline reports.
- Only the report form works offline. Confirming ("I can see this too"), flagging, the map list and the tracker still need signal.
- Offline maps: only tiles already viewed are kept (up to 400). Unviewed areas show a grey map; "Use my location" and tapping the map still record a correct position.
- Saved reports live in the browser. Clearing site data, or the browser evicting storage, deletes unsent reports. The app asks the browser to keep them (granted at the browser's discretion).
- If the anonymous session is lost (site data cleared) after a report was partly sent, that report is marked failed with a clear message instead of being sent under a new identity.
- Not checked against live Supabase: whether the storage policy accepts a re-upload of the same photo path (the queue treats "already exists" as success, so it should be fine) and whether `issue_photos` has a unique constraint (a retry between two saved steps could in theory insert a second photo row; the window is very small).
- Moderator sign-in uses Supabase email magic links. In Supabase: Authentication > URL Configuration, set the Site URL and add `http://localhost:3000/admin` (and your Vercel URL) to the redirect list, or the link will not return to the app. Free-tier email sending is rate limited; add your own SMTP before real use.
- To become a moderator: open `/admin`, sign in once, then run the `insert into moderators` line at the bottom of 005 with your email.
- WhatsApp links need numbers in international format (e.g. 233244123456, no plus or leading zero). The add-party form says so, but nothing validates it.
- The escalation message contains the exact map location. That is intended (the responsible party must find the spot), but it goes only to the party the moderator picks.
- Moderators are trusted fully: they can see exact locations and change any case. Keep the list short.

## Recommended next steps
1. Run setup (SQL files 001-008), become a moderator, and test the whole loop with real reports: report, confirm, assign party, send message, mark sent, add after photo, mark resolved, check the tracker. Fix whatever breaks.
2. Find out who handles each problem type in the launch area and add them as parties (as a moderator, or by approving suggestions on the Directory tab).
3. Deploy to Vercel (the service worker needs HTTPS), then test offline on a real phone: open the site online once, switch to airplane mode, make a report, switch signal back on and watch the banner.
4. Test with 5-10 real residents. Success target: 10+ real reports across 2+ categories, one case sent to a responsible party, ideally one resolved with before/after photos.
5. Later: SMS or WhatsApp notices, WhatsApp intake, phone-number login (stops fake confirmations and keeps reports when a phone changes), a CAPTCHA before turning email on, the community-editable directory.

## Prompt for the new chat
```
I'm an IT student in Ghana building CivicPulse, a civic accountability app for local neighborhood problems (waste, choked gutters, streetlights, potholes). Residents report with a photo and location; the core feature is a public tracker showing whether and how fast each case gets fixed. Act as my technical mentor and pair-programmer. Be practical and honest, and push back if I'm overcomplicating things.

I've attached HANDOVER.md and the SQL files (001-008). Read HANDOVER.md first: it lists decisions made, what's built, what isn't, and known issues. The code is written but I have not yet run it against Supabase.

My context:
- Launch area: [fill in]
- Who handles each problem type there: [fill in or "still finding out"]
- Skill level: [fill in]
- Time per week: [fill in]

Current status: [e.g. "I ran setup and the report form works" or paste any errors]

What I need now: [e.g. "Build the map and list view" or "Fix this error: ..."]

Ask me up to 3 questions before you start.
```
