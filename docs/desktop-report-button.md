# Top bar: "Report a problem" button and tablets

Computers (1024px and up): a gold "Report a problem" button at the end of the tabs. It stays gold on the home page too (the current-page
tab is a dark pill, which made "Report" look like "Reports"). It is hidden on phones, where the camera button does that job.

Tablets (641 to 895px): the bar has two rows. Row 1: logo, then Aa and language on the right. Row 2: the tabs spread across the full width,
with the full gold button. One row did not fit once a language picker showed: it ran off the edge at 768px (iPad portrait) with two languages.

Phones (640px and under): unchanged (five-column bottom bar with the camera in the centre).

Checked by rendering the real bar at 641, 700, 767, 768, 820, 1024 and 1280px, with one language and with two. No sideways scrolling at any of them.
Guard tests in tests/nav.test.mjs. Not checked: real iPads and Android tablets.
