# Emergency signposting, open data and the monthly report

None of these needs a database change.

## 1. Emergency signposting
A report marked **"Dangerous right now"** shows the emergency numbers: while the person fills the form (as soon as they choose that severity), on the "saved" screen after sending, and on the report page until it is resolved. Each number is a tap-to-call button. The text says plainly that CivicPulse is **not** an emergency service and nobody sees reports the moment they are sent.

- Numbers live only in `lib/emergency.js`: 112 (any emergency, free), police 191, fire 192, ambulance 193, NADMO 0302 964 884 (floods and disasters).
- Checked 7 Nov 2026 against the 112 announcement, Wikipedia's list, NADMO's contact page and Graphic Online (7 Jun 2026). Numbers change: re-check once a year. The NADMO line is a headquarters number from its website; if your launch area has a district NADMO office, add that number in the same file.
- Test: choose "Dangerous right now" on the report form; the box must appear and the buttons must dial on a phone.

## 2. Open data
`/data` explains and links two files, built when asked and cached for an hour: `/data/reports.csv` (one row per report) and `/data/offices.csv` (one row per office, the same numbers as the tracker).
- Only already-public columns. Never included: descriptions, photos, anything about who reported, confirmed or answered. Locations are the rounded public ones.
- Names are made safe for spreadsheets (text starting with `= + - @` is prefixed so Excel cannot run it as a formula).
- Large tables are read page by page (Supabase returns at most 1000 rows per request).
- **Your decisions:** the wording of the usage line on `/data` (`openData.licence` in `lib/strings.js`) asks people to credit CivicPulse and says the numbers are community reports. Pick a formal licence (for example CC BY 4.0) if you want one, and change that line. Also decide whether you want to publish locations at all; to stop, remove `lat` and `lng` from `REPORT_COLUMNS` in `lib/openData.js`.
- Test: open `/data/reports.csv` and `/data/offices.csv` on the live site; open them in a spreadsheet; search for a phone number you typed in a test description (it must not appear).

## 3. Monthly report
`/monthly` shows one calendar month (UTC, same as Ghana time), starting with the last full month, with buttons to go to earlier months and a share button (WhatsApp first). It lists, from the same public numbers as the tracker:
- Reports filed, sent to an office, fixed, and the median days to fix.
- **Longest waiting at month end:** offices whose oldest case was still open when the month ended.
- **Most improved:** faster than their own previous 3 months, with at least 3 fixes in both periods (to avoid praising luck).
- **Most problems fixed.**

Limits (also shown on the page): a report fixed and then reopened has no fixed date, so it is not counted in the month it was first fixed; "reopened" is a running total with no date; only reports already sent to an office count against it.

## Also fixed
The tracker used `limit(5000)`, but Supabase returns at most 1000 rows per request, so with more than 1000 reports the tracker would have silently shown only some. It now reads every page.

## Not verified
Tested in Node (stats, CSV building, paging, strings) but the pages and the two CSV routes have not been built or run, because the build tools cannot be installed in the sandbox. Run `npm run build` and look at `/monthly`, `/data` and both CSV files on your machine.
