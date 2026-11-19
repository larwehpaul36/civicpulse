# Duplicate check tweaks
The report form already asked "This may already be reported" at Send (function find_nearby_duplicates, same problem type, open reports only).
Changes: radius 50 m -> 100 m (constant DUPLICATE_RADIUS_M in lib/reportRules.js, because phone GPS is often 20-50 m off);
each match has an "Open this report (new tab)" link so the person can compare the photo and place; a match with no description
shows a hint instead of a dash. No database change: the radius is a function argument. Still skipped for "Other" and when offline.
