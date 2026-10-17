-- Checks 007_notifications.sql against a stand-in database. Run in a THROWAWAY database:
--   createdb civic_test2 && psql -v ON_ERROR_STOP=1 -d civic_test2 -f tests/notifications_stub_test.sql
-- The stand-ins copy only what 007 relies on (auth.uid, issues, confirmations, status_log, public_issues).
-- It does not prove 007 fits your full schema; running 007 live does that.
\set ON_ERROR_STOP on

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create type issue_status as enum ('reported','verified','sent','in_progress','resolved','rejected');
create table issues (id uuid primary key default gen_random_uuid(), reporter_id uuid references auth.users(id),
  status issue_status default 'reported', category_id uuid, description text);
create table confirmations (issue_id uuid references issues(id) on delete cascade, user_id uuid references auth.users(id),
  primary key (issue_id, user_id));
create table status_log (id bigserial primary key, issue_id uuid references issues(id) on delete cascade,
  to_status issue_status not null, created_at timestamptz default now());
create view public_issues as select id, category_id, status, description, 3 as days_open from issues where status <> 'rejected';
grant select on public_issues to anon, authenticated;

\ir ../007_notifications.sql

create function expect_error(stmt text, pattern text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin
    execute stmt;
    ok := true;
  exception when others then
    if sqlerrm !~ pattern then raise exception 'wrong error for [%]: %', stmt, sqlerrm; end if;
  end;
  if ok then raise exception 'expected an error matching % but it succeeded: %', pattern, stmt; end if;
end $$;
grant execute on function expect_error(text, text) to anon, authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),   -- u1 reporter
  ('22222222-2222-2222-2222-222222222222'),   -- u2 confirmed it
  ('33333333-3333-3333-3333-333333333333');   -- u3 unrelated
insert into issues (id, reporter_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');
insert into confirmations values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');  -- also the reporter: must not double up

-- 1. the first "reported" row makes no notification; "sent" notifies reporter and confirmer once each
insert into status_log (issue_id, to_status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'reported');
do $$ begin assert (select count(*) from notifications) = 0, 'no notification for reported'; end $$;
insert into status_log (issue_id, to_status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent');
do $$ begin
  assert (select count(*) from notifications) = 2, 'two recipients';
  assert (select count(distinct user_id) from notifications) = 2, 'no duplicates';
  assert (select bool_and(to_status = 'sent') from notifications), 'status stored';
end $$;

-- 2. people see only their own notifications; anonymous callers without an account see nothing
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin assert (select count(*) from notifications) = 1, 'u1 sees own'; end $$;
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin assert (select count(*) from notifications) = 0, 'u3 sees none'; end $$;
select expect_error('insert into notifications (user_id, issue_id, to_status) values (null, null, ''x'')', 'permission denied');
reset role;
set role anon;
select expect_error('select count(*) from notifications', 'permission denied');
reset role;

-- 3. mark read touches only the caller's rows
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select mark_notifications_read();
reset role;
do $$ begin
  assert (select read_at is not null from notifications where user_id = '11111111-1111-1111-1111-111111111111'), 'u1 read';
  assert (select read_at is null from notifications where user_id = '22222222-2222-2222-2222-222222222222'), 'u2 still unread';
end $$;

-- 4. my_reports returns only the caller's reports
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin assert (select count(*) from my_reports()) = 1 and (select id from my_reports()) = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u1 reports'; end $$;
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin assert (select id from my_reports()) = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u3 reports'; end $$;
reset role; set role anon;
select expect_error('select * from my_reports()', 'permission denied');
reset role;

-- 5. a broken notification step never blocks the status change
alter table notifications rename column to_status to broken;
insert into status_log (issue_id, to_status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'resolved');
do $$ begin assert (select count(*) from status_log where to_status = 'resolved') = 1, 'status change survived'; end $$;
alter table notifications rename column broken to to_status;

-- 6. push subscriptions
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select save_push_subscription('https://push.example/one', 'key', 'auth');
select expect_error($$select save_push_subscription('http://insecure.example/x', 'k', 'a')$$, 'bad_endpoint');
select expect_error($$select save_push_subscription('https://push.example/two', '', 'a')$$, 'bad_endpoint');
select expect_error('select * from push_subscriptions', 'permission denied');
set app.uid = '';
select expect_error($$select save_push_subscription('https://push.example/x', 'k', 'a')$$, 'not_signed_in');
set app.uid = '22222222-2222-2222-2222-222222222222';
select remove_push_subscription('https://push.example/one');   -- not u2's: must not delete
reset role;
do $$ begin assert (select count(*) from push_subscriptions) = 1, 'other users cannot remove it'; end $$;
set role authenticated; set app.uid = '22222222-2222-2222-2222-222222222222';
select save_push_subscription('https://push.example/one', 'key2', 'auth2');   -- same browser, new account: moves over
reset role;
do $$ begin assert (select user_id from push_subscriptions where endpoint = 'https://push.example/one') = '22222222-2222-2222-2222-222222222222', 'endpoint moved'; end $$;
set role authenticated; set app.uid = '33333333-3333-3333-3333-333333333333';
select save_push_subscription('https://push.example/p' || n, 'k', 'a') from generate_series(1, 7) n;
reset role;
do $$ begin assert (select count(*) from push_subscriptions where user_id = '33333333-3333-3333-3333-333333333333') = 5, 'five newest kept'; end $$;
set role authenticated; set app.uid = '33333333-3333-3333-3333-333333333333';
select remove_push_subscription('https://push.example/p7');
reset role;
do $$ begin assert (select count(*) from push_subscriptions where user_id = '33333333-3333-3333-3333-333333333333') = 4, 'own removal works'; end $$;

-- 7. email contact: validation, cooldown, hidden tokens, verification, unsubscribe
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select expect_error($$select set_notification_contact('not an email')$$, 'bad_email');
select expect_error($$select set_notification_contact('a@b')$$, 'bad_email');
select set_notification_contact('  Ama@Example.com ');
select expect_error($$select set_notification_contact('other@example.com')$$, 'too_soon');
do $$ declare r record; begin
  select * into r from my_notification_contact();
  assert r.email = 'ama@example.com' and r.verified = false, 'stored lower-case, unverified';
end $$;
select expect_error('select * from notification_contacts', 'permission denied');
reset role;

update notification_contacts set updated_at = now() - interval '1 hour';     -- time passes
create temp table tok as select verify_token, unsubscribe_token from notification_contacts;
grant select on tok to anon;
set role anon;
do $$ begin
  assert confirm_notification_email((select verify_token from tok)) = true, 'confirm with token';
  assert confirm_notification_email(gen_random_uuid()) = false, 'wrong token';
end $$;
reset role;
do $$ begin assert (select verified_at is not null from notification_contacts), 'verified'; end $$;

set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select set_notification_contact('new@example.com');                           -- changing the address
reset role;
do $$ begin
  assert (select verified_at is null from notification_contacts), 'new address must be verified again';
  assert (select verify_token from notification_contacts) <> (select verify_token from tok), 'fresh token';
end $$;

set role anon;
do $$ begin
  assert unsubscribe_contact((select unsubscribe_token from tok)) = true, 'unsubscribe by token';
  assert unsubscribe_contact(gen_random_uuid()) = false, 'wrong unsubscribe token';
end $$;
reset role;
do $$ begin assert (select count(*) from notification_contacts) = 0, 'contact removed'; end $$;

set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select set_notification_contact('again@example.com');
select clear_notification_contact();
do $$ begin assert (select count(*) from my_notification_contact()) = 0, 'cleared'; end $$;
reset role;

set role anon;
select expect_error($$select set_notification_contact('x@example.com')$$, 'permission denied');
select expect_error($$select save_push_subscription('https://x.example/y','k','a')$$, 'permission denied');
reset role;

\echo 'notifications: all checks passed'
