# About page, first-visit note and iPhone notification guide (13 Nov 2026)

Source: a first-time user's written assessment (4.5 out of 5). Three things he asked for, and what was built:
1. **Clear introduction**: `/about` page (`app/about/page.js`, text in `lib/strings.js` under `about`), a dismissible "New here?" note on the home page for first-time visitors (`components/NewHere.js`; remembered per phone), and a "How it works" link under the home hero. The About link is in the top bar on computers; on phones the bottom bar is full, so it is reached from the home page.
2. **iPhone notifications need the Home Screen**: `components/InstallGuide.js` shows five numbered steps ONLY on an iPhone or iPad that has not added the site yet (`lib/installGuide.js`, tested). It appears open under the notifications panel on My reports when notifications are unsupported, and inside the About page.
3. **Accessibility not evident**: NOT in this change. Planned: an Accessibility page, keyboard drawing for the photo-hiding box, and a text-size control.

**Claims on the About page the owner must confirm before publishing:** "an independent project, not run by the government or by any assembly"; "free"; "anyone in Ghana". Contact shows `NEXT_PUBLIC_CONTACT_EMAIL` if set, otherwise "Contact details will be added soon".

No database change. English only; the new text joins the next round of translations.
