# Map links on the admin screen

Residents still pick the spot on the OpenStreetMap map (offline-friendly, no Google needed).
Only the moderator's links changed.

- `lib/mapLinks.js`: `googleMapsUrl`, `osmUrl`, `coordsText`. Both links carry the same latitude/longitude,
  so the pin is on the same spot in either map. The background maps may differ in detail.
- Admin card: coordinates as text, "Open in Google Maps" and "Open in OpenStreetMap".
- Office message: `Location:` uses the Google link. If the location is missing or 0,0 the line is left out.
- Missing or 0,0 location: "No location saved for this report." and no links (it used to build `mlat=null`).
- Tests: `tests/mapLinks.test.mjs`. No migration. Nothing is sent to Google until someone taps the link.

Check by hand: open 2-3 real reports, tap both links, confirm the pins match.
