# Share as a picture (build 9)

Each report page already had a WhatsApp button and a link preview. This adds a square picture (1080 x 1080) people can post as a
WhatsApp Status, on Facebook or Instagram, or send in a group, where a link preview does not show. It costs nothing to run.

- Report page: **Share as a picture** (opens the phone's share sheet with the picture attached and the link in the text) and **Save the picture**.
- A phone or browser that cannot share files opens the picture in a new tab so it can be saved.
- The picture shows the photo (or the gold rings), the status, the problem, days open and confirmations, and the office.
  A **fixed** report says "Fixed after N days" and "Fixed because residents reported it. Thank you." An open one asks "Seen it too? Confirm it on CivicPulse."
- Public facts only, the same as the link preview: no location, no description, no names. An unknown report gives the CivicPulse brand picture, never an error.
- Address: `/issues/<report id>/card`. It is cached for 5 minutes.

No migration. Files: `lib/ogCard.js` (the layout), `app/issues/[id]/card/route.js`, `lib/sharePicture.js`, `components/ShareButton.js`.

## Test plan
1. Open any report page on a phone. Tap **Share as a picture**: choose WhatsApp, check the picture and the text with the link.
2. Tap **Save the picture**: the picture saves or opens. Open `/issues/<id>/card` directly in a browser: a square picture appears.
3. Check a fixed report (it should say "Fixed ... Thank you.") and one with a very long title.
4. On a desktop browser, **Share as a picture** should open the picture in a new tab.

## Known limits
- I could not run the real image maker (Next.js `ImageResponse`) in my sandbox. The layout was tested and drawn as plain HTML, which is close but not identical: look at the first real picture on the preview.
- Instagram does not accept pictures from a web share on every phone. WhatsApp Status and Facebook usually do.
