-- 011b: switch the phone rules ON. Run ONLY after phone login works end to end (docs/phone-login-setup.md, steps 1 to 6).
-- Not part of supabase/setup_all.sql on purpose: the setup file must never turn this on by accident.
-- Once on: confirming a report, and sending a second report within 24 hours, need a confirmed phone number.
-- If residents get stuck, switch it off again at once with the two lines in the comment at the bottom.
-- Requires 011_phone_verified.sql to have been run first.

alter table confirmations enable trigger confirmations_need_phone;
alter table issues        enable trigger issues_need_phone;

-- CHECK: both rows must show O (on):
select tgname, tgenabled from pg_trigger where tgname in ('confirmations_need_phone', 'issues_need_phone') order by tgname;

-- TO SWITCH OFF AGAIN (instant, nothing is lost):
--   alter table confirmations disable trigger confirmations_need_phone;
--   alter table issues        disable trigger issues_need_phone;
