# Accessibility work (13 Nov 2026)

Answers the "accessibility evidence" point of the first-time-user assessment.

## What was added
- `/accessibility` page: what works, what has NOT been tested, how we check, how to report a problem. Text lives in `strings.a11yPage`.
  Rule: every line in `does` must be true in the code today. Remove a line when its feature is removed. Add real gaps to `gaps`.
- Footer on every page (`SiteFooter`): About, Accessibility, Privacy, Open data, and a text-size control.
  On phones the bottom bar has no room for About, so the footer is also how phone users reach it.
- Text size (`lib/textSize.js`, `TextSize`): Normal / Large / Largest, kept in this browser only (localStorage, never sent anywhere).
  CSS scales the root font size (`html[data-textsize]` in `components/footer.css`). A tiny script in `<head>` applies it before first paint.
- Photo hiding without dragging (`PhotoBlur`): "Add a box with buttons" starts a box in the middle; Move left/up/down/right, Make bigger/smaller, Hide this box, Cancel this box.
  Pure helpers `defaultBox`, `stepSize`, `nudge`, `resize` in `lib/blur.js`.
- `/about` and `/accessibility` added to the axe audit (`tests/a11y/axe.spec.mjs`).

## Not done (be honest about it on the page)
- No outside audit; no testing with daily screen-reader users; map inner workings are Leaflet/OpenStreetMap.
- Translations of the new strings: they fall back to English until reviewers supply them (add to `translations/review-*.csv` on next export).

## Checking by hand (10 minutes, on the Vercel preview)
1. Keyboard only (no mouse): press Tab from the top. First stop is "Skip to main content". Reach the footer and press Enter on Accessibility.
2. Make a report, choose a photo, open "Hide faces...", press "Add a box with buttons", move it with the buttons, press "Hide this box": the area becomes a mosaic.
3. Footer: press Largest; all text grows and stays readable on a phone width. Reload: size is remembered. Press Normal to go back.
4. Screen reader (TalkBack on Android or VoiceOver on iPhone): on the footer, each size button is announced as "Text size: Large, button, pressed/not pressed".

## Phone top bar (16-18 Nov 2026)
- Top bar on phones: logo, "Aa" text size (cycles Normal/Large/Largest), language pill, "☰" menu (About, Accessibility, Privacy, Open data). The menu is hidden on computers, where About is in the top bar and the rest are in the footer. The footer links stay as a backup.
- The bottom bar has icon + short label tabs in five equal columns; the camera is always centred (`components/topbar.css`, guarded by `tests/nav.test.mjs`).
- Language pill shows a short code (EN, TW, HA, EE, GA) on phones narrower than 344px so the bar fits (`lib/languageLabel.js`).
- Lesson: render every layout change (Playwright + the real CSS, 320/360/390px, English and Hausa, light and dark) before delivering it. A rule with a higher specificity re-showed hidden tabs once.
- Not yet checked on a real Android phone. Send screenshots when testing.

## Required fields on the report form (18 Nov 2026)
A first-time user said the photo field should be marked required: people only learned it was needed when they pressed Next.
- Every required field has a red star, and a note under the step count says "* means you must fill it in."
- Pressing Next with something missing shows a message under each missing field ("Required: add a photo of the problem. ..."), outlines it in red, and moves the cursor to the first one. The messages disappear as the field is filled.
- The rules live in `lib/reportRules.js` (tested). Required: problem type, photo, "Other" wording (only for Other), region, spot on the map. Optional: seriousness, district, details.
- Screen readers already had `aria-required`; they now also hear the message through `aria-describedby` and `aria-invalid`.
- New English strings are in `strings.req`; Twi and Hausa show English for them until reviewed (they will appear in the next review CSV export).

## Required fields on the other forms (18 Nov 2026)
Same idea as the report form, using `lib/formRules.js` (tested) and the shared star in `components/Req.js`.
- Suggest an office (`DirectoryForm`): new office needs name, type, area and at least one problem type; adding coverage needs area and a problem type; "this entry is wrong" needs a note of 5+ characters; a plain correction needs nothing here.
- Moderator office reply (`AdminReplyForm`): an expected date needs the date (words optional); a reply or "not our job" needs the words. Matches `checkReply` (tested).
- Email boxes (`KeepAccount`, `NotificationSettings`): one field each, so no star. The button is no longer silently greyed out; pressing it with an empty or wrong box says what is wrong, in the app's own wording, and puts the cursor there. The updates form also asks for the consent tick.
- The browser's own "required" pop-ups are turned off on these forms (`noValidate`): they appeared only on Send, in the browser's language.
- Tidy-ups: the "Problems they handle" list is flat (the label no longer cuts across a box line) and shows a red outline when missing; the date box now matches the other fields; the moderator's form has even spacing and a full-width Publish button.
- The phone check (`PhoneVerify`) was left alone: one field, and it already shows its own error.
- Checked by running the real forms in a browser with a stub database (27 behaviours: messages, cursor, messages clearing, nothing sent while incomplete, exact payloads).
