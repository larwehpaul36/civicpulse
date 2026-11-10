-- 016: keep moderators' private notes on the contact log private. Run after 015. Safe to run twice.
-- The public report page only shows the channel, whether a response came, and the date. But the table was
-- readable in full through the API, so anyone could also read the free-text note and who logged the contact.
-- After this, the public can read only the columns the page uses. Moderators are not affected: they log
-- contacts through admin_log_contact(), which runs with owner rights.

revoke select on contact_attempts from anon, authenticated;
grant select (id, issue_id, party_id, channel, response_received, created_at) on contact_attempts to anon, authenticated;

-- CHECK (expect: an error, "permission denied for table contact_attempts"):
--   set role anon;  select note from contact_attempts limit 1;  reset role;
-- CHECK (expect: works):
--   set role anon;  select channel, response_received, created_at from contact_attempts limit 1;  reset role;
