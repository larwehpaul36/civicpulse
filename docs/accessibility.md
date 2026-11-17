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
