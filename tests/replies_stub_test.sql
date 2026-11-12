-- Self-checking test for migration 021 (office replies) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_replies && psql -v ON_ERROR_STOP=1 -q -d civic_replies -f tests/replies_stub_test.sql
-- Stand-ins for issues, parties, moderators and auth are simplified copies. Not covered: real Supabase auth and the front end.
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create function assert_moderator() returns void language plpgsql as $$ begin if not is_moderator() then raise exception 'not_moderator' using errcode='42501'; end if; end $$;
create table responsible_parties (id uuid primary key default gen_random_uuid(), name text);
create table issues (id uuid primary key, status text default 'sent', party_id uuid);
alter table issues enable row level security;
create policy "issues readable" on issues for select using (status <> 'rejected');
grant select on issues, responsible_parties to anon, authenticated;

insert into responsible_parties (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Test Assembly');
insert into issues (id, status, party_id) values
  ('00000000-0000-0000-0000-000000000001', 'sent', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000002', 'reported', null),
  ('00000000-0000-0000-0000-000000000003', 'rejected', '00000000-0000-0000-0000-0000000000a1');
insert into moderators values ('11111111-1111-1111-1111-111111111111');

\i 021_office_replies.sql
\i 021_office_replies.sql   -- twice: must be safe

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
select expect('moderator adds a reply', admin_add_office_reply('00000000-0000-0000-0000-000000000001', 'reply', '  We will visit on Friday.  ') is not null);
select expect('moderator adds an expected date', admin_add_office_reply('00000000-0000-0000-0000-000000000001', 'expected_date', null, current_date + 7) is not null);
select expect('moderator adds not_ours', admin_add_office_reply('00000000-0000-0000-0000-000000000001', 'not_ours', 'This is the Water Company''s pipe.') is not null);
select expect('text is trimmed and the office is taken from the report',
  (select body = 'We will visit on Friday.' and party_id = '00000000-0000-0000-0000-0000000000a1' from office_replies where kind = 'reply'));
select throws('bad kind', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','shout','hi')$q$, 'bad_kind');
select throws('unknown report', $q$select admin_add_office_reply('00000000-0000-0000-0000-0000000000ff','reply','hi')$q$, 'issue_not_found');
select throws('report with no office', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000002','reply','hi')$q$, 'no_party');
select throws('empty reply', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','reply','   ')$q$, 'text_required');
select throws('over 500 characters', format($q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','reply',%L)$q$, repeat('x', 501)), 'too_long');
select throws('date missing', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','expected_date')$q$, 'date_required');
select throws('date in the past', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','expected_date',null,current_date - 1)$q$, 'bad_date');
select throws('date too far away', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','expected_date',null,current_date + 400)$q$, 'bad_date');
select admin_add_office_reply('00000000-0000-0000-0000-000000000001','reply','dropped-date check', current_date + 3);
select expect('a date sent with a plain reply is dropped', (select expected_date is null from admin_list_office_replies('00000000-0000-0000-0000-000000000001') where body = 'dropped-date check'));
select expect('moderator list shows all', (select count(*) = 4 from admin_list_office_replies('00000000-0000-0000-0000-000000000001')));
reset role;

-- the public
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select expect('public can read replies on a visible report', (select count(*) = 4 from office_replies));
select throws('public cannot read who relayed', 'select relayed_by from office_replies', 'permission denied');
select throws('public cannot read removal details', 'select removed_by from office_replies', 'permission denied');
select throws('public cannot insert', $q$insert into office_replies (issue_id, kind, body) values ('00000000-0000-0000-0000-000000000001','reply','x')$q$, 'permission denied');
select throws('public cannot update', $q$update office_replies set body = 'x'$q$, 'permission denied');
select throws('public cannot delete', $q$delete from office_replies$q$, 'permission denied');
select throws('public cannot call add', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','reply','x')$q$, 'permission denied');
select throws('public cannot list as moderator', $q$select * from admin_list_office_replies('00000000-0000-0000-0000-000000000001')$q$, 'permission denied');
reset role;

-- a signed-in non-moderator
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('resident cannot add', $q$select admin_add_office_reply('00000000-0000-0000-0000-000000000001','reply','x')$q$, 'not_moderator');
select throws('resident cannot hide', $q$select admin_hide_office_reply(gen_random_uuid())$q$, 'not_moderator');
select throws('resident cannot list', $q$select * from admin_list_office_replies('00000000-0000-0000-0000-000000000001')$q$, 'not_moderator');
reset role;

-- hiding, and replies on a rejected report
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select admin_hide_office_reply((select id from office_replies where kind = 'not_ours'));
select expect('moderator still sees the hidden one, marked', (select count(*) = 1 from admin_list_office_replies('00000000-0000-0000-0000-000000000001') where removed_at is not null));
reset role;
set role anon;
select expect('hidden reply disappears for the public', (select count(*) = 3 from office_replies));
reset role;
insert into office_replies (issue_id, kind, body) values ('00000000-0000-0000-0000-000000000003', 'reply', 'on a rejected report');
set role anon;
select expect('replies on a rejected report stay hidden', (select count(*) = 3 from office_replies));
reset role;
