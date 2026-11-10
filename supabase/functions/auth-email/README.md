# auth-email: optional limits on sign-in emails (keeps room for moderators)

Skip this unless you switch on resident email sign-in (`docs/email-signin-setup.md`) and want a firm guarantee that
residents asking for link emails again and again cannot use up the project's email allowance and block **moderator** sign-in links.

What it does: Supabase hands every sign-in email to this function instead of sending it. The function asks the database
(`018_auth_email_throttle.sql`) whether this person may have another one, then sends it through Resend.
- Moderators: always sent, never counted against residents.
- Residents: 4 emails per account per day, 3 per address per day, 30 per hour and 300 per day in total (edit the lines marked `LIMIT` in 018 and run it again).
- The database keeps only a one-way fingerprint of each address, deleted after 3 days.
- If the database cannot be reached the email is still sent, so a fault in the counter can never lock anyone out.

## Steps
1. Run `018_auth_email_throttle.sql` in the SQL editor. On its own it changes nothing.
2. Resend: create an account, verify your sending domain, make an API key. Use the same sender as in the setup guide.
3. Function secrets (dashboard > Edge Functions > Secrets): `RESEND_API_KEY`, `EMAIL_FROM` (like `CivicPulse <login@your-domain>`), and `SEND_EMAIL_HOOK_SECRET` (step 5 gives you this). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
4. Deploy: `supabase functions deploy auth-email --no-verify-jwt` (it checks the hook's signature itself).
5. Dashboard > Authentication > Hooks > **Send Email**: choose HTTPS, URL `https://YOUR-PROJECT.supabase.co/functions/v1/auth-email`, generate the secret and copy it into `SEND_EMAIL_HOOK_SECRET` (keep the `v1,whsec_...` form). Enable the hook.
6. Test: request a sign-in link; it should arrive from your sender. Ask for 5 links for one account within a day: the 5th must not arrive. A moderator account must keep getting links.

## Switching it off
Disable the hook in the dashboard. Supabase goes back to sending through your SMTP settings; nothing else changes.

## What is not verified
- This was tested in Node with stand-ins for Supabase and Resend, not against a live project.
- Supabase's docs do not say how a refused email (HTTP 429 from the hook) appears to the app. The app shows its generic "Please try again" message for anything it does not recognise.
- With the hook on, Supabase's own "emails per hour" setting may or may not still apply. Check Authentication > Rate Limits after switching it on.
- Email changes: the new address gets its link; an account that already has an address and is changing it may also get a second email to the old one (Supabase's "secure email change"). Anonymous phones have no old address, so they get one email.
