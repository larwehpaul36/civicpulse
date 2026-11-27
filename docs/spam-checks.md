# Spam and fake-report checks (build 12)

Migration **029**. Free, no new service. Nothing is hidden or rejected automatically: rules refuse abuse at the door and **suggest** to moderators; people decide.

## Refused at the door
- More than 5 reports in 10 minutes, or 10 in 24 hours, from one account. The report stays on the phone as "failed" with a plain message and a Try again button.
- A location outside Ghana (a generous box) or no location. Same plain message.
- More than 20 flags in 24 hours from one account, so flagging cannot be used to attack honest reports.
- Moderators and SQL-editor changes are never limited. Numbers are marked `LIMIT` in 029; edit and run it again to change them.

## Suspicious tab (moderators)
Open reports that score 2 or more: 2+ flags (2), 3+ reports from one account within a day (2), the same words in another report (2), a web address in the text (2), a phone-like number in the text (1), account under 10 minutes old when it reported (1). Each report shows the reasons in words. Use the tick boxes and bulk bar (build 11) to reject many, or "Dismiss flags" on one that is fine. Every action appears in Activity.

## Honest limits
- Someone who can create unlimited anonymous accounts gets round per-account limits. The real wall is the captcha on sign-in (Turnstile); keep it on in Production.
- Photos are not checked. Hints can be wrong, which is why a moderator decides.
- Reports that fail only the "outside Ghana" test near a border may need a larger box: tell me if an honest report is refused.

## Test plan
1. Run 029, then its CHECK query (expect true, true, false).
2. On a phone, send a normal report: it works.
3. Send 6 reports quickly (use test data): the 6th shows the "wait a little" message and a Try again button.
4. In /admin open Suspicious: a report whose text has a web address shows "The text contains a web address."
5. Tick it, Reject in the bar, and see it in Activity.
