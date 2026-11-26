-- Self-checking test for migration 026 (office staff accounts, on top of 021, 022 and 025) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_staff && psql -v ON_ERROR_STOP=1 -q -d civic_staff -f tests/office_staff_stub_test.sql
-- Stand-ins for issues, parties, moderators, auth.users and geometry are simplified copies. Not covered: real Supabase sign-in and the front end.
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean default false);
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- stand-in for PostGIS: a point type and the two accessors the function uses
create type geometry as (x double precision, y double precision);
create function st_x(g geometry) returns double precision language sql immutable as $$ select (g).x $$;
create function st_y(g geometry) returns double precision language sql immutable as $$ select (g).y $$;

create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create function assert_moderator() returns void language plpgsql as $$ begin if not is_moderator() then raise exception 'not_moderator' using errcode='42501'; end if; end $$;
create table responsible_parties (id uuid primary key default gen_random_uuid(), name text);
create table issues (id uuid primary key, status text default 'sent', party_id uuid, reporter_id uuid);
alter table issues add column category_id uuid, add column other_label text, add column region_id uuid, add column severity text default 'high',
  add column description text, add column confirmation_count int default 0, add column duplicate_of uuid,
  add column created_at timestamptz default now(), add column sent_at timestamptz, add column resolved_at timestamptz, add column location geometry;
create table issue_photos (id uuid primary key default gen_random_uuid(), issue_id uuid, kind text, storage_path text, created_at timestamptz default now());
create table confirmations (issue_id uuid, user_id uuid);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, issue_id uuid not null, to_status text not null,
  created_at timestamptz default now(), read_at timestamptz);
alter table issues enable row level security;
create policy "issues readable" on issues for select using (status <> 'rejected');
grant select on issues, responsible_parties to anon, authenticated;

insert into responsible_parties (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Ga East Assembly'), ('00000000-0000-0000-0000-0000000000a2', 'Other Assembly');
insert into issues (id, status, party_id, description, sent_at, location) values
  ('00000000-0000-0000-0000-000000000001', 'sent',        '00000000-0000-0000-0000-0000000000a1', 'Pothole mine',     now(), row(-0.187, 5.6037)::geometry),
  ('00000000-0000-0000-0000-000000000002', 'reported',    '00000000-0000-0000-0000-0000000000a1', 'Not yet sent',     null,  row(-0.2, 5.6)::geometry),
  ('00000000-0000-0000-0000-000000000003', 'sent',        '00000000-0000-0000-0000-0000000000a2', 'Theirs',           now(), row(-0.3, 5.7)::geometry),
  ('00000000-0000-0000-0000-000000000004', 'resolved',    '00000000-0000-0000-0000-0000000000a1', 'Fixed one',        now(), row(-0.1, 5.5)::geometry),
  ('00000000-0000-0000-0000-000000000005', 'rejected',    '00000000-0000-0000-0000-0000000000a1', 'Rejected',         now(), row(0, 0)::geometry),
  ('00000000-0000-0000-0000-000000000006', 'in_progress', '00000000-0000-0000-0000-0000000000a1', 'In progress mine', now(), row(-0.15, 5.65)::geometry);
insert into issues (id, status, party_id, description, sent_at, duplicate_of) values
  ('00000000-0000-0000-0000-000000000007', 'sent', '00000000-0000-0000-0000-0000000000a1', 'A duplicate', now(), '00000000-0000-0000-0000-000000000001');
insert into issue_photos (issue_id, kind, storage_path) values ('00000000-0000-0000-0000-000000000001', 'before', 'before/1.jpg');
insert into moderators values ('11111111-1111-1111-1111-111111111111');
update issues set reporter_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000001';
insert into confirmations values ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- people: a moderator, an invited officer, an uninvited signed-in person, an unconfirmed address, an anonymous resident, a second officer
insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
  ('11111111-1111-1111-1111-111111111111', 'mod@civic.example',        now(),  false),
  ('22222222-2222-2222-2222-222222222222', 'Officer@GaEast.example',   now(),  false),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.com',     now(),  false),
  ('44444444-4444-4444-4444-444444444444', 'pending@gaeast.example',   null,   false),
  ('55555555-5555-5555-5555-555555555555', null,                       null,   true),
  ('66666666-6666-6666-6666-666666666666', 'officer@other.example',    now(),  false);

\i 021_office_replies.sql
\i 022_office_reply_notices.sql
\i 025_office_reply_links.sql
\i 026_office_staff.sql
\i 026_office_staff.sql   -- twice: must be safe

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;

-- ---------------- before any invitation nobody has access
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select expect('an uninvited person sees no office', (select count(*) = 0 from staff_my_offices()));
select expect('an uninvited person sees no reports', (select count(*) = 0 from staff_list_issues()));
select throws('an uninvited person cannot reply', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'hello')$q$, 'issue_not_found');
select throws('a non-moderator cannot invite', $q$select admin_invite_office_staff('officer@gaeast.example', '00000000-0000-0000-0000-0000000000a1')$q$, 'not_moderator');
select throws('a non-moderator cannot list staff', $q$select * from admin_list_office_staff()$q$, 'not_moderator');
select throws('the staff table is private', 'select email from office_staff', 'permission denied');
select throws('the internal helper is not callable', 'select * from staff_party_ids()', 'permission denied');
reset role;

-- ---------------- a moderator invites
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select throws('bad email', $q$select admin_invite_office_staff('not-an-email', '00000000-0000-0000-0000-0000000000a1')$q$, 'bad_email');
select throws('empty email', $q$select admin_invite_office_staff('  ', '00000000-0000-0000-0000-0000000000a1')$q$, 'bad_email');
select throws('null email', $q$select admin_invite_office_staff(null, '00000000-0000-0000-0000-0000000000a1')$q$, 'bad_email');
select throws('unknown office', $q$select admin_invite_office_staff('officer@gaeast.example', '00000000-0000-0000-0000-0000000000ff')$q$, 'party_not_found');
create temp table inv (n serial, id uuid);
grant all on inv, inv_n_seq to authenticated;
insert into inv (id) select admin_invite_office_staff('  Officer@GaEast.example ', '00000000-0000-0000-0000-0000000000a1');
insert into inv (id) select admin_invite_office_staff('officer@gaeast.example', '00000000-0000-0000-0000-0000000000a1');
select expect('the same invitation twice is one invitation', (select count(distinct id) = 1 from inv) and (select count(*) = 1 from admin_list_office_staff()));
select expect('the email is stored in lower case, trimmed', (select email = 'officer@gaeast.example' from admin_list_office_staff()));
select admin_invite_office_staff('pending@gaeast.example', '00000000-0000-0000-0000-0000000000a1');
select admin_invite_office_staff('officer@other.example', '00000000-0000-0000-0000-0000000000a2');
select admin_invite_office_staff('mod@civic.example', '00000000-0000-0000-0000-0000000000a1');  -- a moderator who is also invited: fine
select expect('moderators can list active staff', (select count(*) = 4 from admin_list_office_staff()));
reset role;

-- ---------------- an invited, confirmed officer
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select expect('the officer sees exactly their own office (email match ignores capitals)', (select count(*) = 1 and bool_and(name = 'Ga East Assembly') from staff_my_offices()));
select expect('the officer sees sent, in-progress and resolved reports of their office only',
  (select count(*) = 3 and bool_and(party_name = 'Ga East Assembly') from staff_list_issues()));
select expect('not-yet-sent, rejected, duplicate and other offices are hidden',
  (select count(*) = 0 from staff_list_issues() where description in ('Not yet sent', 'Rejected', 'A duplicate', 'Theirs')));
select expect('the exact location and photo come through',
  (select lat = 5.6037 and lng = -0.187 and before_path = 'before/1.jpg' from staff_list_issues() where description = 'Pothole mine'));
select expect('reply counts start at zero', (select bool_and(replies_count = 0) from staff_list_issues()));

select expect('a reply is accepted', staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', '  We will send a crew on Friday.  ') is not null);
select expect('an expected date is accepted', staff_add_reply('00000000-0000-0000-0000-000000000001', 'expected_date', null, current_date + 5) is not null);
select expect('a reply on an in-progress report is accepted', staff_add_reply('00000000-0000-0000-0000-000000000006', 'not_ours', 'Water company pipe.') is not null);
select throws('not their office', $q$select staff_add_reply('00000000-0000-0000-0000-000000000003', 'reply', 'hi')$q$, 'issue_not_found');
select throws('missing report looks the same as someone else''s', $q$select staff_add_reply('00000000-0000-0000-0000-0000000000ff', 'reply', 'hi')$q$, 'issue_not_found');
select throws('not yet sent to the office', $q$select staff_add_reply('00000000-0000-0000-0000-000000000002', 'reply', 'hi')$q$, 'not_open');
select throws('already resolved', $q$select staff_add_reply('00000000-0000-0000-0000-000000000004', 'reply', 'hi')$q$, 'not_open');
select throws('rejected', $q$select staff_add_reply('00000000-0000-0000-0000-000000000005', 'reply', 'hi')$q$, 'not_open');
select throws('a duplicate', $q$select staff_add_reply('00000000-0000-0000-0000-000000000007', 'reply', 'hi')$q$, 'issue_not_found');
select throws('bad kind', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'shout', 'x')$q$, 'bad_kind');
select throws('empty text', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', '   ')$q$, 'text_required');
select throws('over 500', format($q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', %L)$q$, repeat('x', 501)), 'too_long');
select throws('date missing', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'expected_date')$q$, 'date_required');
select throws('date in the past', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'expected_date', null, current_date - 1)$q$, 'bad_date');
select throws('date too far', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'expected_date', null, current_date + 400)$q$, 'bad_date');
select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'with a stray date', current_date + 3);
select expect('the reply counts and the date show on the list',
  (select replies_count = 3 and expected_date = current_date + 5 from staff_list_issues() where description = 'Pothole mine'));
select expect('replies are public, tied to the right office, labelled as from the office, text trimmed',
  (select count(*) = 1 from office_replies where source = 'office' and body = 'We will send a crew on Friday.' and party_id = '00000000-0000-0000-0000-0000000000a1'));
select expect('a stray date on a plain reply is dropped', (select expected_date is null from office_replies where body = 'with a stray date'));
reset role;
select expect('the reply records which account wrote it (private)', (select bool_and(relayed_by = '22222222-2222-2222-2222-222222222222') from office_replies where source = 'office'));
select expect('followers were told, once each (022 still works)', (select count(*) = 2 from notifications where to_status = 'office_reply' and issue_id = '00000000-0000-0000-0000-000000000001'));
select expect('last seen is recorded', (select last_seen_at is not null from office_staff where email = 'officer@gaeast.example'));

-- ---------------- the daily limit
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'spam ' || g) from generate_series(1, 7) g;   -- 3 earlier + 7 = the limit of 10 a day
select throws('too many replies in a day', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'one too many')$q$, 'rate_limited');
reset role;

-- ---------------- people who must NOT get in
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
set role authenticated;
select expect('a signed-in stranger sees nothing', (select count(*) = 0 from staff_my_offices()) and (select count(*) = 0 from staff_list_issues()));
select throws('a signed-in stranger cannot reply', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'hi')$q$, 'issue_not_found');
reset role;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
set role authenticated;
select expect('an invited but UNCONFIRMED email sees nothing', (select count(*) = 0 from staff_my_offices()) and (select count(*) = 0 from staff_list_issues()));
reset role;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
set role authenticated;
select expect('an anonymous resident account sees nothing', (select count(*) = 0 from staff_my_offices()) and (select count(*) = 0 from staff_list_issues()));
select throws('an anonymous resident cannot reply', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'hi')$q$, 'issue_not_found');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select throws('a visitor with no account cannot list', 'select * from staff_list_issues()', 'permission denied');
select throws('a visitor with no account cannot reply', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'hi')$q$, 'permission denied');
select throws('a visitor cannot invite', $q$select admin_invite_office_staff('a@b.co', '00000000-0000-0000-0000-0000000000a1')$q$, 'permission denied');
select throws('a visitor cannot read the staff table', 'select * from office_staff', 'permission denied');
reset role;

-- ---------------- the second office is separate
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
set role authenticated;
select expect('the other office sees only its own report', (select count(*) = 1 and bool_and(description = 'Theirs') from staff_list_issues()));
select throws('and cannot reply to the first office''s report', $q$select staff_add_reply('00000000-0000-0000-0000-000000000001', 'reply', 'hi')$q$, 'issue_not_found');
reset role;

-- ---------------- revoking works at once
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select admin_revoke_office_staff((select id from admin_list_office_staff() where email = 'officer@gaeast.example'));
select expect('a revoked person is gone from the list', (select count(*) = 3 from admin_list_office_staff()));
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select expect('a revoked officer sees nothing straight away', (select count(*) = 0 from staff_my_offices()) and (select count(*) = 0 from staff_list_issues()));
select throws('and cannot reply any more', $q$select staff_add_reply('00000000-0000-0000-0000-000000000006', 'reply', 'hi')$q$, 'issue_not_found');
reset role;
select expect('their earlier replies stay on the public record', (select count(*) >= 4 from office_replies where source = 'office'));

-- ---------------- the same person can be invited again after being revoked
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select admin_invite_office_staff('officer@gaeast.example', '00000000-0000-0000-0000-0000000000a1');
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select expect('and then has access again', (select count(*) = 1 from staff_my_offices()));
reset role;

-- ---------------- at most 10 active people per office
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select admin_invite_office_staff('p' || g || '@gaeast.example', '00000000-0000-0000-0000-0000000000a1') from generate_series(1, 7) g;   -- 3 already + 7 = 10
select throws('the 11th person is refused', $q$select admin_invite_office_staff('eleven@gaeast.example', '00000000-0000-0000-0000-0000000000a1')$q$, 'too_many');
reset role;
\echo ALL STAFF CHECKS RAN
