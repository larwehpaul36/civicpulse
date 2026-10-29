> **PAUSED.** Arkesel only issues OTP sender IDs to registered businesses, so phone login is on hold. Keep the two database triggers disabled. This guide is for when a registered organisation is behind the app.

# Phone login setup (Arkesel + Supabase + Vercel)

Order matters: the database rules in step 6 are the last switch. Until then nothing changes for residents.

1. **Deploy the code** (git push). Nothing breaks: the phone sheet only opens when the database refuses something, and it will not until step 6.
2. **Arkesel** (sms.arkesel.com): create an account, load a small amount of credit, create an API key, and register the sender name `CivicPulse` (Ghana requires approved sender names, which can take time; until yours is approved, ask Arkesel support which sender name your account may use and put that in `ARKESEL_SENDER_ID`). Keep the API key private: never paste it in a chat, in code, or in a `NEXT_PUBLIC_` variable.
3. **Supabase > Authentication > Sign In / Providers > Phone**: switch it on, set the code length to 6 and the expiry to 600 seconds (10 minutes). You do not need Twilio or any provider details, because the hook below sends the text.
4. **Supabase > Authentication > Auth Hooks > Send SMS**: add a hook of type HTTPS with the URL `https://civicpulse-live.vercel.app/api/auth/send-sms`. Click **Generate secret** and copy it (it starts with `v1,whsec_`).
5. **Vercel > Settings > Environment Variables** (Production), then redeploy without the build cache:
   - `SEND_SMS_HOOK_SECRET` = the secret from step 4 (mark Sensitive)
   - `ARKESEL_API_KEY` = your Arkesel key (mark Sensitive)
   - `ARKESEL_SENDER_ID` = `CivicPulse` (or the sender name Arkesel approved)
   - `NEXT_PUBLIC_CONTACT_EMAIL` = the contact address for the Privacy Notice (optional but recommended)
   Also in **Supabase > Authentication > Rate Limits**: lower the SMS limit (for example 30 per hour) as a cost cap. Your Arkesel balance is the hard cap.
6. **Test before switching the rules on**: open `https://civicpulse-live.vercel.app/verify` on your phone, tap **Confirm my phone**, use your own number, and check the text arrives and the code works. Try a wrong code once.
7. **Then run `011_phone_verified.sql`** in the Supabase SQL editor. From now on, confirming a report and sending a second report within 24 hours need a confirmed phone.
8. Run `npm run check:live` (add `NEXT_PUBLIC_SITE_URL=https://civicpulse-live.vercel.app` to `.env.local` first).

If a text does not arrive: check the Arkesel balance and sender approval first, then Vercel > Logs for `/api/auth/send-sms` (the app logs the reason but never the code or the number).
