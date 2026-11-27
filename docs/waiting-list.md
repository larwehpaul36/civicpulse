# Reports waiting longest for a reply (build 10)

The tracker (`/tracker`) now names the reports, not only the counts.

- **Top of the office list:** "Waiting longest for a reply", the 10 reports that have waited longest across all offices, each linking to its public page, with the office and the days waiting.
- **On each office card:** "See the reports waiting longest" opens that office's 5 longest waits (and "And N more").
- Waiting means: sent to an office, still open, and **no public reply of any kind** yet (an answer, a fix date or "not ours" all count as a reply). Fixed, rejected and not-yet-sent reports never show.
- The category filter at the top of the tracker also filters these lists.
- If migration 021 has not been run, the lists are hidden (never shown as "everything is waiting").
- No migration, no new data. It uses what the tracker already loads. Pure rule: `waitingList` in `lib/trackerStats.js`.
- The honest note stays: if an office told us something that was not recorded, the report still shows here. The note now says offices can reply on their own page or by private link (it used to say they cannot sign in).

## Test plan
1. Open `/tracker` on a phone. Below the numbers and chart, find "Waiting longest for a reply".
2. Tap one report: the public report page opens.
3. Open an office card and tap "See the reports waiting longest". Check the days match the card's "Longest wait".
4. Pick a category at the top: both lists change.
5. As an office (build 7), reply to a listed report. After a refresh it should leave the list.

## Known limits
- Days are counted from when the report was sent to the office, not working days.
- A public list can embarrass an office that did reply by phone. Moderators should record those replies promptly; the follow-up tab (build 8) helps.
- Tests: `tests/trackerStats.test.mjs` (waitingList and page checks). Real phones not covered.
