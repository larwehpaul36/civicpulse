-- Self-checking test for migration 027 (the moderator follow-up list) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_follow && psql -v ON_ERROR_STOP=1 -q -d civic_follow -f tests/followup_stub_test.sql
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create type geometry as (x double precision, y double precision);
create function st_x(g geometry) returns double precision language sql immutable as $$ select (g).x $$;
create function st_y(g geometry) returns double precision language sql immutable as $$ select (g).y $$;
create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create function assert_moderator() returns void language plpgsql as $$ begin if not is_moderator() then raise exception 'not_moderator' using errcode='42501'; end if; end $$;
create table responsible_parties (id uuid primary key default gen_random_uuid(), name text, email text, phone text, whatsapp text);
create table issues (id uuid primary key, status text, party_id uuid, category_id uuid, other_label text, severity text default 'high', description text,
  confirmation_count int default 0, created_at timestamptz default now(), sent_at timestamptz, duplicate_of uuid, location geometry);
create table contact_attempts (id uuid primary key default gen_random_uuid(), issue_id uuid, party_id uuid, channel text, note text, response_received boolean, created_by uuid, created_at timestamptz default now());
create table office_replies (id uuid primary key default gen_random_uuid(), issue_id uuid, kind text, body text, expected_date date, removed_at timestamptz, created_at timestamptz default now());
insert into moderators values ('11111111-1111-1111-1111-111111111111');
insert into responsible_parties (id, name, email, phone, whatsapp) values ('00000000-0000-0000-0000-0000000000a1', 'Ga East', 'ga@x.gh', '0200000000', '233200000000');
insert into issues (id, status, party_id, description, sent_at, location) values
  ('00000000-0000-0000-0000-000000000001', 'sent',        '00000000-0000-0000-0000-0000000000a1', 'quiet one',     now() - interval '10 days', row(-0.187, 5.6037)::geometry),
  ('00000000-0000-0000-0000-000000000002', 'in_progress', '00000000-0000-0000-0000-0000000000a1', 'replied one',   now() - interval '40 days', row(-0.2, 5.6)::geometry),
  ('00000000-0000-0000-0000-000000000003', 'resolved',    '00000000-0000-0000-0000-0000000000a1', 'fixed',         now() - interval '40 days', null),
  ('00000000-0000-0000-0000-000000000004', 'reported',    '00000000-0000-0000-0000-0000000000a1', 'not sent',      null, null),
  ('00000000-0000-0000-0000-000000000005', 'sent',        null,                                   'no office',     now(), null),
  ('00000000-0000-0000-0000-000000000006', 'rejected',    '00000000-0000-0000-0000-0000000000a1', 'rejected',      now(), null);
insert into issues (id, status, party_id, description, sent_at, duplicate_of) values ('00000000-0000-0000-0000-000000000007', 'sent', '00000000-0000-0000-0000-0000000000a1', 'a duplicate', now(), '00000000-0000-0000-0000-000000000001');
insert into office_replies (issue_id, kind, body, expected_date, created_at, removed_at) values
  ('00000000-0000-0000-0000-000000000002', 'reply', 'noted', null, now() - interval '35 days', null),
  ('00000000-0000-0000-0000-000000000002', 'expected_date', null, current_date - 10, now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000000002', 'expected_date', null, current_date - 3, now() - interval '20 days', null),
  ('00000000-0000-0000-0000-000000000002', 'reply', 'hidden by moderator', null, now() - interval '1 day', now());
insert into contact_attempts (issue_id, note, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'Case sent',      now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000000001', 'Reminder sent',  now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001', 'Reminder sent',  now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000002', 'Escalated to Ashanti RCC', now() - interval '3 days');
\i 027_followup_queue.sql
\i 027_followup_queue.sql   -- twice: must be safe

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select expect('only open, sent reports with an office, no duplicates', (select count(*) = 2 from admin_followup_queue()));
select expect('resolved, rejected, not-sent, no-office and duplicates are left out',
  (select count(*) = 0 from admin_followup_queue() where description in ('fixed', 'not sent', 'no office', 'rejected', 'a duplicate')));
select expect('the office contact details come through for the message',
  (select party_email = 'ga@x.gh' and party_whatsapp = '233200000000' and party_phone = '0200000000' and party_name = 'Ga East' from admin_followup_queue() where description = 'quiet one'));
select expect('the location comes through', (select lat = 5.6037 and lng = -0.187 from admin_followup_queue() where description = 'quiet one'));
select expect('reminders are counted from the private contact log, and only "Reminder sent" ones',
  (select reminders_count = 2 and last_reminder_at > now() - interval '3 days' and last_escalation_at is null from admin_followup_queue() where description = 'quiet one'));
select expect('an escalation is found by its note', (select last_escalation_at > now() - interval '4 days' and reminders_count = 0 from admin_followup_queue() where description = 'replied one'));
select expect('no reply yet shows zero replies and no date', (select replies_count = 0 and last_reply_at is null and expected_date is null from admin_followup_queue() where description = 'quiet one'));
select expect('a hidden reply is not counted', (select replies_count = 3 from admin_followup_queue() where description = 'replied one'));
select expect('the LATEST promised date wins, not the earliest', (select expected_date = current_date - 3 from admin_followup_queue() where description = 'replied one'));
select expect('the last visible reply time is used', (select last_reply_at < now() - interval '19 days' from admin_followup_queue() where description = 'replied one'));
reset role;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('a non-moderator cannot read the list', 'select * from admin_followup_queue()', 'not_moderator');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select throws('a visitor cannot call it', 'select * from admin_followup_queue()', 'permission denied');
reset role;
\echo ALL FOLLOW-UP CHECKS RAN
