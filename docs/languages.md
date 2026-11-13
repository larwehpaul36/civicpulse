# Languages (Twi, Hausa, Ewe, Ga)

**State:** the switch and the machinery are built. Twi and Hausa have a first draft; Ewe and Ga are empty templates. **No draft has been reviewed, so none is visible to residents.** The language picker does not even appear until a language is approved.

## How a language reaches residents
| Status in `lib/languages.js` | Who sees it |
|---|---|
| `empty` | nobody (no text yet) |
| `draft` | only where `NEXT_PUBLIC_SHOW_UNREVIEWED_LANGS=1` (set this on Vercel **Preview** so reviewers can try it) |
| `live` | everyone, in the picker in the top bar |

Approving a language = changing its `status` to `'live'` in a pull request. That commit is the record of who approved what and when.

## For a reviewer
1. Open `translations/review-tw.csv` (or `-ha`) in Excel or Google Sheets. Columns: where it appears, **English**, the **draft**, and a column for **your correction**. Leave the correction blank if the draft is right.
2. Check the rows marked **SAFETY WORDING** first. They are the emergency notice; people may act on them.
3. Read each line as a resident would on a phone: short, natural, how people actually speak, not textbook. Loanwords like "map" and "browser" are fine if that is what people say.
4. Lines with `[n=1]` and `[n=3]` are the same sentence for one and for three, so the plural form can be checked.
5. Send the sheet back. For Ewe and Ga the draft column is empty: write the translation in the correction column.
6. Try it on the Preview site with the unreviewed switch on, filling in a real report in that language, before approving.

## What is translated (round 1) and what is not
Round 1 is the report-and-confirm path: top bar, report form (all three steps), photo hiding, the sent screen, confirming, status names, the emergency notice, and the home page. **Still English:** the privacy notice (it needs a legal check before any translation), My reports, the tracker and monthly pages, the directory, the moderator screens, the data page, error pages, and the text in push messages and emails (`supabase/functions/notify/core.js`). Anything untranslated falls back to English, so nothing breaks.

## Problem-type names
Names like "Pothole" are data in the database, as `{"en": "...", "tw": "..."}`. `023_category_translations_draft.sql` adds draft Twi and Hausa names (safe: they only show once the language is shown). Run it in the Supabase SQL editor; run it again after any correction.

## Things to know
- Switching language rebuilds the page, so finish or send a report before switching. The page shows English for a moment on load before the saved language is applied.
- The saved choice is in the phone's browser storage only (no cookie, no server).
- Adding a language: copy `lib/lang/tw.js`, translate, add an entry to `lib/languages.js` and to the list in `lib/lang.js`, run `node scripts/export-translations.mjs xx > translations/review-xx.csv`. `npm test` checks that a language file has the same shape as English.
- Not machine-checked, and cannot be: whether the words are right.
