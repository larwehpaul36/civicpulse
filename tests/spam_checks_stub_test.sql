-- Self-checking test for migration 029 (spam and fake-report checks) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_spam && psql -v ON_ERROR_STOP=1 -q -d civic_spam -f tests/spam_checks_stub_test.sql
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create type geometry as (x double precision, y double precision);
create function st_x(g geometry) returns double precision language sql immutable as $$ select (g).x $$;
create function st_y(g geometry) returns double precision language sql immutable as $$ select (g).y $$;
create type issue_status as enum ('reported','verified','sent','in_progress','resolved','rejected');
create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create function assert_moderator() returns void language plpgsql as $$ begin if not is_moderator() then raise exception 'not_moderator' using errcode='42501'; end if; end $$;
create table issues (id uuid primary key default gen_random_uuid(), reporter_id uuid, status issue_status default 'reported', description text,
  duplicate_of uuid, location geometry, created_at timestamptz default now());
create table flags (issue_id uuid, user_id uuid, reason text, created_at timestamptz default now());
insert into moderators values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id, email, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'mod@x.gh', now() - interval '99 days'),
  ('22222222-2222-2222-2222-222222222222', 'old@x.gh', now() - interval '5 days'),
  ('33333333-3333-3333-3333-333333333333', 'spammer@x.gh', now() - interval '5 days'),
  ('44444444-4444-4444-4444-444444444444', 'fresh@x.gh', now());
\i 029_spam_checks.sql
-- run twice: must be safe
\i 029_spam_checks.sql

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
insert into issues (reporter_id, description, location) values ('22222222-2222-2222-2222-222222222222', 'Open drain near the market', row(-0.187, 5.6037)::geometry);
select expect('an honest report in Accra goes through', true);
select throws('a location outside Ghana is refused', $$insert into issues (reporter_id, location) values ('22222222-2222-2222-2222-222222222222', row(2.35, 48.85)::geometry)$$, 'outside_ghana');
select throws('(0,0) is refused', $$insert into issues (reporter_id, location) values ('22222222-2222-2222-2222-222222222222', row(0, 0)::geometry)$$, 'outside_ghana');
select throws('a missing location is refused', $$insert into issues (reporter_id, location) values ('22222222-2222-2222-2222-222222222222', null)$$, 'outside_ghana');
insert into issues (reporter_id, description, location) values ('22222222-2222-2222-2222-222222222222', 'north', row(-0.8, 10.9)::geometry), ('22222222-2222-2222-2222-222222222222', 'coast', row(1.2, 5.0)::geometry);
select expect('the far north and the coast edges are accepted', true);
-- that is 3 reports so far; 2 more allowed in 10 minutes, then the 6th is refused
insert into issues (reporter_id, description, location) values ('22222222-2222-2222-2222-222222222222', 'four', row(-0.2, 5.6)::geometry), ('22222222-2222-2222-2222-222222222222', 'five', row(-0.2, 5.6)::geometry);
select throws('the 6th report in 10 minutes is refused', $$insert into issues (reporter_id, description, location) values ('22222222-2222-2222-2222-222222222222', 'six', row(-0.2, 5.6)::geometry)$$, 'report_rate_limited');
reset role;
-- spread older ones out so only the 24 hour limit applies
update issues set created_at = now() - interval '5 hours';
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
insert into issues (reporter_id, description, location) select '22222222-2222-2222-2222-222222222222', 'extra ' || g, row(-0.2, 5.6)::geometry from generate_series(1, 5) g;
select throws('the 11th report in 24 hours is refused', $$insert into issues (reporter_id, description, location) values ('22222222-2222-2222-2222-222222222222', 'eleven', row(-0.2, 5.6)::geometry)$$, 'report_rate_limited');
reset role;
select set_config('request.jwt.claim.sub', '', false);   -- nobody signed in, like the SQL editor
insert into issues (reporter_id, location) values ('22222222-2222-2222-2222-222222222222', row(2, 48)::geometry);
select expect('SQL-editor writes (no signed-in user) are never limited', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into issues (reporter_id, location) values ('22222222-2222-2222-2222-222222222222', row(-0.2, 5.6)::geometry);
select expect('moderators are not limited', true);
reset role;

-- flag limit
insert into issues (id, description, location) values ('00000000-0000-0000-0000-0000000000f1', 'target', row(-0.2, 5.6)::geometry);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
set role authenticated;
insert into flags (issue_id, user_id) select gen_random_uuid(), '33333333-3333-3333-3333-333333333333' from generate_series(1, 20);
select throws('the 21st flag in a day is refused', $$insert into flags (issue_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', '33333333-3333-3333-3333-333333333333')$$, 'flag_rate_limited');
reset role;
delete from flags;

-- the review list
delete from issues;
insert into issues (id, reporter_id, description, location, created_at) values
  ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Open drain near the market', row(-0.2, 5.6)::geometry, now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Buy cheap loans at www.loans.example call 0244123456', row(-0.2, 5.6)::geometry, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Same words repeated here', row(-0.2, 5.6)::geometry, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', '  Same   WORDS repeated here ', row(-0.2, 5.6)::geometry, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000005', '44444444-4444-4444-4444-444444444444', 'short', row(-0.2, 5.6)::geometry, now()),
  ('00000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'Rejected one with a link http://x.example', row(-0.2, 5.6)::geometry, now());
update issues set status = 'rejected' where id = '00000000-0000-0000-0000-000000000006';
insert into flags (issue_id, user_id) values ('00000000-0000-0000-0000-000000000001', gen_random_uuid());
insert into flags (issue_id, user_id) values ('00000000-0000-0000-0000-000000000005', gen_random_uuid()), ('00000000-0000-0000-0000-000000000005', gen_random_uuid());

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('a resident cannot see the review list', $$select * from admin_spam_review()$$, 'not_moderator');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select expect('a normal report with one flag is not listed', (select count(*) = 0 from admin_spam_review() where issue_id = '00000000-0000-0000-0000-000000000001'));
select expect('a link plus a phone number (plus a burst of 3 from one account) is listed with the reasons',
  (select reasons @> array['link', 'number'] and score = 5 from admin_spam_review() where issue_id = '00000000-0000-0000-0000-000000000002'));
select expect('repeated words are caught whatever the spacing and case, and a burst of 3 from one account is noticed',
  (select count(*) = 2 and bool_and(reasons @> array['same_text', 'burst']) from admin_spam_review() where issue_id in ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004')));
select expect('2 flags plus a brand new account is listed', (select reasons @> array['flagged', 'new_account'] and score = 3 from admin_spam_review() where issue_id = '00000000-0000-0000-0000-000000000005'));
select expect('rejected reports are not listed again', (select count(*) = 0 from admin_spam_review() where issue_id = '00000000-0000-0000-0000-000000000006'));
select expect('highest score first', (select score = (select max(s.score) from admin_spam_review() s) from admin_spam_review() limit 1));
reset role;
select expect('nothing was hidden or rejected by the rules', (select count(*) = 1 from issues where status = 'rejected'));
select expect('anonymous cannot call the review list', not has_function_privilege('anon', 'admin_spam_review()', 'execute'));
