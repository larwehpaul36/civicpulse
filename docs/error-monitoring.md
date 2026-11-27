# Error monitoring (build 13)

Migration **030**. Free, nothing to install, no outside service.

## How it works
- When the app breaks on a phone (a page fails to draw, a click causes an error, a background action fails), the page sends a **short note** to your own database. Moderators read it in **/admin → Errors**.
- One line per kind of error with a count, first and last time, the page, the device and the top of the technical trace. Mark one **fixed**; if it happens again an hour or more later it comes back by itself.
- Visitors see a calm "Something went wrong" page with Try again and Go to the start, instead of a blank screen. Their saved reports are untouched.

## Privacy
- No user id, no IP address, no names. Only the page path (never the part after `?`).
- Emails, phone-like numbers and long codes inside messages are blanked before saving. Rows are deleted after 60 days.
- Only moderators can read the log.
- Not sent: "no signal", browser-extension errors, the captcha being blocked, and old-page "chunk" errors, because they say nothing about a bug.

## Limits
- Each visit sends at most 5 different notes; the database accepts at most 100 new kinds an hour overall.
- It only sees errors that run in the browser. Errors on the server (for example a failed image card) are in the Vercel logs: Vercel → project → Logs.
- It cannot tell you the site is down. For that, add a free uptime check (UptimeRobot, 5-minute check on your home page) when you launch.

## Test plan
1. Run 030, then its CHECK query (expect false, true, false, true).
2. Open /admin → Errors: "No problems reported. Good."
3. Make a test error: open the home page on a computer, press F12, in Console type `setTimeout(() => { throw new Error('test error from me') })` and Enter. Reopen Errors: one line "Script error", 1 time.
4. Do it again: the count goes to 2 (only after reloading the page, since one visit sends the same error once).
5. Mark it fixed: it leaves the list. Tick nothing else is needed.
