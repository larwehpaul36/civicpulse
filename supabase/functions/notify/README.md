# notify: push and email for CivicPulse

The database writes a row to `notifications` whenever a report's status changes (007). A Database
Webhook calls this function for each row, and the function sends the web push and, if the person
set one up and verified it, an email. The in-app updates on `/my` need none of this.

Push and email are independent: leave a channel's settings out and it is skipped.

## 1. Keys and settings
Generate push keys once: `npx web-push generate-vapid-keys`

Function secrets (Supabase dashboard > Edge Functions > Secrets, or `supabase secrets set ...`):

| Name | Needed for | Value |
|---|---|---|
| `WEBHOOK_SECRET` | always | any long random string; the webhook must send the same one |
| `SITE_URL` | always | your site address with no trailing slash, e.g. `https://civicpulse.example` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | push | from the command above |
| `VAPID_SUBJECT` | push | `mailto:you@example.com` |
| `RESEND_API_KEY`, `EMAIL_FROM` | email | from your Resend account; `EMAIL_FROM` like `CivicPulse <updates@your-domain>` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically.

App settings (`.env.local`, and on Vercel): `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the same public key. Set
`NEXT_PUBLIC_EMAIL_NOTICES=1` only once email is set up and you have reviewed the privacy wording.

## 2. Deploy
`supabase functions deploy notify --no-verify-jwt`
(The function checks `x-webhook-secret` itself, so it does not use a login token.)

## 3. Two Database Webhooks (dashboard > Database > Webhooks)
Both: type "HTTP Request", method POST, URL `https://YOUR-PROJECT.supabase.co/functions/v1/notify`,
header `x-webhook-secret` = your `WEBHOOK_SECRET`, header `Content-Type: application/json`.
1. Table `notifications`, event Insert.
2. Table `notification_contacts`, events Insert and Update (sends the "confirm your email" message).

## 4. Check
Mark a test report "sent" in `/admin`, with a second browser or account following it. You should see the
update on `/my` straight away, a push if that browser turned it on, and the function's logs under Edge Functions > Logs.
