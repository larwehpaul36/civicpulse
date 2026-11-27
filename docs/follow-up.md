# Follow-up: reminders and escalation (build 8)

A new **Follow-up** tab on the moderator desk lists open reports where a nudge is due. Nothing is sent automatically.
The moderator sends the prepared message (WhatsApp, email or copy), then presses "I sent it" so CivicPulse remembers.

## The rules (`lib/followUp.js`, one place, easy to change)
| Situation | What shows |
|---|---|
| Sent to the office 7+ days ago, no reply at all | **Send a reminder** |
| Sent 30+ days ago, no reply at all | **Go above the office** (escalate) |
| The office gave a fix date and it has passed | **Promised date missed** (reminder) |
| 21+ days past the promised date | **Go above the office** |
| The office replied once, nothing for 30 days, no fix date | **Gone quiet** (reminder) |
- The clock starts when the report was **sent to the office**, not when it was reported.
- After a reminder the report rests 7 days. After an escalation it rests 14. A reminder never hides the need to escalate.
- A promised date is on time all through that day. A future promise is respected.
- Resolved, rejected, not-yet-sent, duplicate and no-office reports never show.

## What the moderator does
- **Reminder:** optionally press "Add a private reply link" (so the office can answer in one tap), then WhatsApp (to the office's number), email, or copy. Then "I sent the reminder".
- **Escalation:** optionally choose the higher office (typed search) for the greeting, then WhatsApp or email and pick the person yourself in the app, or copy. Then "I escalated it".
- The record goes in the existing private contact log (`contact_attempts`) as "Reminder sent" or "Escalated to ...". Moderators only.

## Order of work
1. Supabase SQL editor: run `027_followup_queue.sql` once (needs 021). Safe to run twice. No new tables.
2. Check, expect `false, true`: the query at the bottom of the file.
3. Merge build 7 (office page) first if you have not: this build edits the same admin page and strings.
4. Deploy, test, merge.

## Test plan
1. Moderator desk: the **Follow-up** tab. Without 027 it stays empty and nothing breaks.
2. After 027: a report that was sent 8+ days ago with no reply shows "Send a reminder". If you have no such report, ask me for a way to age one for testing.
3. Open it, tap Copy, paste somewhere: check the message reads well and names the office.
4. Press "I sent the reminder". The report should leave the list.
5. Check an escalation card: the greeting uses the office you typed, or "Sir or Madam".

## Known limits
- No automatic sending, no push alerts to the moderator yet. The tab shows the count in its label.
- The rules count days, not working days. Public holidays are not considered.
- Tests: `tests/followUp.test.mjs` (10), `tests/followup_stub_test.sql` (12). Real WhatsApp and real phones are not covered.
