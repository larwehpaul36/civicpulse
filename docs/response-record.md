# Office response record (tracker)

Each office card on /tracker now has a "Replies from the office" block: cases replied to, median days from sent to first reply,
cases still waiting, and the longest wait. /data/offices.csv gains four columns: replied, median_days_to_first_reply,
waiting_for_reply, longest_wait_days.

- No new migration. It reads `office_replies` (migration 021), which the public can already read (without who relayed it).
- A reply is any public reply kind: answer, expected date, or "not ours". Hidden replies are excluded by the database.
- Fixed cases with no reply are neither "replied" nor "waiting".
- If 021 has not been run, the reply block and the "Fastest to reply" sort are hidden, and the CSV columns are blank (never zero).
- Offices do not sign in yet: a moderator records replies, so "waiting" can mean "not heard or not recorded". The page says so.
- Offices with fewer than 3 cases keep the existing "Early data" chip.
- Rules are pure functions in lib/trackerStats.js (firstReplies, replyDays, partyStats third argument, sort "reply"), tested in
  tests/trackerStats.test.mjs and tests/openData.test.mjs.
