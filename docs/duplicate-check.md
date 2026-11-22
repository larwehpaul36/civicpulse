# Duplicate check ("This may already be reported")

When: on the place step, as soon as the person presses Next with a spot chosen (not at Send, after the photo and details are done).
It looks for open reports of the same problem type within 100 m (`DUPLICATE_RADIUS_M` in lib/reportRules.js; function
`find_nearby_duplicates`, argument `radius_m`, so no database change). Phone GPS is often 20 to 50 m off, so 50 m missed real matches.

What the person sees: each match with its text (or "No description was written. Open the report to see the photo and place."),
how long it has been open, its confirmations, an "Open this report (new tab)" link, and "Confirm this report".
Then "This is a different problem" (goes on to the review step; from the review step it sends) and "Go back to my report".
Nothing typed or chosen is lost.

Asked once per spot and problem type (`duplicateKey`): pressing "different problem" is remembered, so Send does not ask again.
If the spot or the type changes, it asks again. Rules in `lib/reportRules.js` (`duplicateKey`, `duplicateCheckDue`), tested in tests/reportRules.test.mjs.

Skipped for "Other" (there is no fixed type to match) and when the phone is offline. Without signal the report still goes through.
A failed check never blocks a report.

Checked with the real form in a browser (stubbed database): match screen on the place step, radius and type sent, go back keeps entries,
"different problem" goes to review without sending, Send queues once without asking again, no match goes straight on, offline and "Other" skip it.
Not checked: the real database function on a live project, and real GPS accuracy in the field.
