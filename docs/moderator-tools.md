# Moderator tools (build 11)

Migration **028** plus changes to the admin screen.

## Bulk actions
- On the admin lists, every report has a tick box. "Select all shown" ticks the first 50 (the limit).
- A bar appears with: mark as confirmed, mark as sent, mark as in progress, **reject**, assign an office, clear the flags.
- Reject, send, assign and clear-flags ask for a second tap to confirm.
- Each report is checked on its own with the same rules as one at a time. "Sent" needs an office. "Fixed" is not offered in bulk because it needs an after photo.
- The answer says "7 of 9 done" and why the others failed. The failed ones stay ticked so you can fix them and try again.
- Assigning in bulk does **not** teach the system a default office for that category and area (one at a time still can).

## Who did what
- New **Activity** tab. Every moderator change is recorded with the moderator's email: status changes, office assignments, category changes, cleared flags, hidden office replies, staff invited or removed.
- Written by database triggers, so it also catches changes made any other way by a signed-in moderator. Residents' own actions are not logged here.
- Bulk actions show as one line ("Marked 12 reports as rejected" with a Bulk tag).
- Read-only. Only moderators can read it, nobody can edit or delete it from the app. Emails are private data.
- "Only my actions" filter. Shows the latest 100, or 300 with "Show more".

## Several moderators
Add a moderator in Supabase (SQL editor), after they have signed in once at /admin:
`insert into moderators (user_id) select id from auth.users where email = 'new@example.com';`
Remove: `delete from moderators where user_id = (select id from auth.users where email = 'new@example.com');`
All moderators currently see everything (no region limits yet).

## Test plan
1. Run 028 in the Supabase SQL editor, then the CHECK query at the bottom (expect false, true, false, true).
2. Open /admin on a phone. Tick two reports in "Needs action". The bar appears.
3. Choose "Reject" and Apply. It asks to tap again. Confirm. Both leave the list.
4. Open the Rejected tab, tick them, choose "Mark as confirmed". They come back.
5. Tick a report with no office, choose "Mark as sent to the office". It fails with "had no office yet" and stays ticked.
6. Open the Activity tab. You see your actions, bulk ones grouped.
7. Do the same in dark mode and on Android.

## Known limits
- Selection is per tab and clears when you change tab.
- The bar sits above the list, so with many reports ticked you scroll up to apply.
- No region limits for moderators, no "undo". Reversing a bulk action is another bulk action.
- Contact logs (case sent, reminder sent) are in each report's contact history and not repeated in Activity.
