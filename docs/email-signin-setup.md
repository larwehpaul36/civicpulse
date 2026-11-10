# Email sign-in setup (optional: reports survive a lost phone)

Free, and no business registration needed (unlike SMS). Residents can still report with no account, no email and no phone number.
This only adds a choice on **My reports**: "Keep your reports if you change phone". The email is attached to the same anonymous account, so every report made so far stays with it. On a new phone they sign in with the same email and get their reports back.

**What it does not do:** it does not change which confirmations count (see `015_confirmation_quality.sql`). Email addresses are easy to make, so an email is for getting reports back, not proof of anything.

**Nothing changes until you switch it on.** The feature is hidden until `NEXT_PUBLIC_EMAIL_ACCOUNTS=1`. Do steps 1 to 6 first, because Supabase's built-in email service **only sends to the email addresses of your own team members, and only 2 emails per hour for the whole project**. Without custom SMTP, residents would press the button and never get a link.

1. **Choose an email sending service** (SMTP). Resend and Brevo both have free plans (check their current limits and what they need to verify your sending address; most want a domain you own). You already use Resend for update emails if `RESEND_API_KEY` is set. Note the host, port, username and password they give you.
2. **Supabase** > Authentication > Emails (SMTP Settings) > turn on **Custom SMTP**. Enter a sender address on your verified domain, a sender name (CivicPulse), and the host, port, username and password. Save, then send yourself a test.
3. **Supabase** > Authentication > Providers > **Email**: make sure it is enabled and **Confirm email** is ON.
4. **Supabase** > Authentication > sign-in settings: turn on **Allow manual linking**. Supabase needs this to add an email to an anonymous account.
5. **Supabase** > Authentication > URL Configuration > **Redirect URLs**: add `https://civicpulse-live.vercel.app/my` (your real address) and `http://localhost:3000/my`. Moderator sign-in already needs `/admin` there.
6. **Supabase** > Authentication > Emails > Templates. Edit **Change Email Address** (sent when someone adds an email) and **Magic Link** (sent when someone signs in on a new phone). Supabase's docs do not say which one is used for which step, so edit both. Keep `{{ .ConfirmationURL }}` in each. Suggested wording:
   - Subject: `Confirm your email for CivicPulse`
   - Body: `Open this link on your phone to keep your CivicPulse reports safe: {{ .ConfirmationURL }}. If you did not ask for this, ignore this email and nothing changes.`
7. **Supabase** > Authentication > Rate Limits: set emails per hour to something your sender allows. Anyone can ask for a link, so a bad actor could use up the hour's emails and block **moderator** sign-in links too. Keep Turnstile on (it guards the sign-in request) and watch Authentication > Logs. To keep room for moderators for certain, also set up the optional email limits in `supabase/functions/auth-email/README.md` (run `018_auth_email_throttle.sql`, deploy the function, switch on the hook).
7b. Run `017_merge_anonymous_reports.sql` in the SQL editor. It lets a phone that already has reports bring them along when its owner signs in to an existing account (see "Good to know").
8. **Vercel** > Settings > Environment Variables: `NEXT_PUBLIC_EMAIL_ACCOUNTS` = `1` (Production). Redeploy **without** the build cache.

## Test it (on a real phone, once)
1. Make a report. Open **My reports**. Under "Keep your reports if you change phone", enter your email and press **Email me a link**. Open the link **on the same phone**. You should land on My reports and read "Your reports are saved under ...", with your report still listed.
2. In a private window on a computer: open `/my`, choose **Already added your email? Sign in**, enter the same email, open the link. The report appears.
3. Type an email that has no account: the message must read the same as for a real one (it must not reveal who has an account). Do the same under **Keep your reports** with an address that ALREADY has an account: you should see the same "If we can use ... we have sent it a link" message, and a sign-in link should arrive.
3b. Reports coming along: on a phone that has a report and no email, use "Already added your email? Sign in" (or "Keep your reports" with an address that already has an account), open the link on the same phone. My reports should say "We added 1 report from this phone to your account." and list it together with the account's older reports. Check with `select count(*) from merge_tickets where used_at is not null;` (should be 1 or more).
4. In the private window press **Sign out on this phone**. Reload on the phone: still signed in, reports still there.
5. If step 1 says "Email sign-in is not available right now", recheck steps 2 to 4 (the browser console shows Supabase's real error).
6. Optional proof the account was kept: in the SQL editor, `select id, email, is_anonymous from auth.users where email = 'your@email';` should show the same id as `select reporter_id from issues order by created_at desc limit 1;` from your own report.

To switch it off, set the flag to `0` and redeploy. Accounts that already added an email keep it.

## Good to know
- The email lives only in Supabase's private sign-in table. It is never on a public page or in any view. The privacy notice says so; check the wording against the Ghana Data Protection Act, as for email updates.
- This is separate from **email updates** (`NEXT_PUBLIC_EMAIL_NOTICES`): that one sends status emails and has its own consent box. Adding an email here does not turn updates on.
- Signing out uses "this phone only". Supabase's default would sign the person out on all their phones. Signing out also turns off push alerts for that account on that phone.
- Adding an email that already has an account used to say so. It now quietly sends a sign-in link instead and shows the same message either way, so the screen no longer reveals which addresses have accounts. Small leftovers: the two cases may differ slightly in how long they take, and Supabase's own rate-limit answers are not hidden.
- A phone with reports that signs in to an existing account brings them along (017). Before the link is sent, the phone gets a one-time ticket (only a fingerprint is stored in the database) and keeps it with the email address; once signed in to THAT address's account, the phone hands the ticket over and the reports, photos, confirmations, flags, update notices, push alerts, update-email address and directory suggestions move. A confirmation the person already made with the other account is not counted twice and nobody is left confirming their own report. A ticket works once, for 24 hours, and only if the link is opened on the same phone. If it is opened elsewhere, the reports stay on the old phone and nothing is lost.
- If the phone cannot get a ticket (offline, or the migration is not run) and it has reports, no sign-in link is sent and the person sees "We could not get the reports on this phone ready to move". With no reports on the phone, the sign-in goes ahead.
- Reports point at the account (`reporter_id references auth.users`). Do not delete anonymous users to "tidy up" without checking: Supabase refuses to delete accounts that have reports, and clearing out the rest is safe only if nothing refers to them.
- Not verified without a live project: the app decides "signed in" from a **confirmed email**, not from Supabase's `is_anonymous` flag, because Supabase's documentation does not say what that flag becomes. Test step 6 shows what your project does.
