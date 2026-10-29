# Bot protection setup (Cloudflare Turnstile + Supabase)

Free, and no business registration needed. It makes it much harder for scripts to create thousands of fake anonymous accounts.
It cannot stop a determined person using a real browser, so keep moderating.

**Order matters.** If Supabase's CAPTCHA is switched on before the site has the key, nobody can create a new account (reporting and confirming stop working for new visitors, and moderator login fails). So: key first, test, then switch Supabase on.

1. **Cloudflare** (dash.cloudflare.com, free account) > **Turnstile** > **Add widget**.
   - Name: CivicPulse
   - Hostnames: `civicpulse-live.vercel.app` (add `localhost` too if you want to test on your own computer)
   - Widget mode: **Managed**
   - Create, then copy the **Site key** (public) and the **Secret key** (private).
2. **Vercel** > Settings > Environment Variables > add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the Site key (Production). Redeploy **without** the build cache.
3. **Test with Supabase still off.** Open the site in a private window and file a report, or tap "I can see this too". It should work as before, and the page quietly gets a check token in the background. If a small Cloudflare box appears, that is the check asking for one tap.
4. **Supabase** > Authentication > Attack Protection (older dashboards: Bot and Abuse Protection) > **Enable CAPTCHA protection** > provider **Cloudflare Turnstile** > paste the **Secret key** > Save. The secret key goes only here. Never put it in Vercel as a `NEXT_PUBLIC_` variable, in code, or in a chat.
5. **Test again in a fresh private window** (new visitors are the ones affected; people already signed in are not asked again):
   - file a report, then check it arrives
   - open `/admin` and request the moderator sign-in link, then check the email arrives
6. **If anything goes wrong**, switch CAPTCHA protection off in Supabase (instant). The app works as before.

## Rate limits: leave the default
Supabase > Authentication > Rate Limits has a limit on anonymous sign-ins per network address (30 per hour by default). Do not lower it much. Mobile networks in Ghana often put many people behind one shared address, so a low limit would block real residents on busy days. The bot check does this job better.

## If a resident reports that nothing happens
They may be on a network that blocks Cloudflare, or the check timed out. Their report is kept on the phone and retried automatically; it is not lost.
