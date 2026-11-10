-- Self-checking test for migrations 011, 011b, 014, 015, 016, 017, 018, 019 and 020 on a throwaway Postgres (no PostGIS needed).
-- Run from the project root:
--   createdb civic_hard && psql -v ON_ERROR_STOP=1 -q -d civic_hard -f tests/hardening_stub_test.sql
-- It builds small stand-ins for the tables and policies those migrations touch (copied from 001 and 003) and
-- prints PASS or FAIL per check; it stops with an error if anything fails.
-- NOT covered here: PostGIS (the stand-in replaces ONLY the one-line issue_latlng helper that reads the real
-- location), Supabase auth, storage, and the front end. Run the CHECKS at the bottom of each migration on the live project.
\pset pager off
\set QUIET on
\o /dev/null

create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, created_at timestamptz default now(), phone_confirmed_at timestamptz,
                         is_anonymous boolean not null default false, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- stand-ins copied from 001/003/005 (issues is simplified: no PostGIS; test_lat/test_lng stand in for location)
create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create table issues (id uuid primary key, reporter_id uuid, status text default 'reported', confirmation_count int default 0,
                     created_at timestamptz default now(), test_lat double precision, test_lng double precision);
alter table issues enable row level security;
create policy "issues readable" on issues for select using (status <> 'rejected');
create policy "report issues" on issues for insert with check (auth.uid() = reporter_id);
create table issue_photos (id uuid primary key default gen_random_uuid(), issue_id uuid not null references issues(id) on delete cascade,
  kind text not null check (kind in ('before','after')), storage_path text not null, uploaded_by uuid references auth.users(id), created_at timestamptz default now());
create table contact_attempts (id uuid primary key default gen_random_uuid(), issue_id uuid not null references issues(id) on delete cascade,
  party_id uuid, channel text, note text, response_received boolean default false, created_by uuid references auth.users(id), created_at timestamptz default now());
create table confirmations (issue_id uuid references issues(id) on delete cascade, user_id uuid references auth.users(id),
  created_at timestamptz default now(), primary key (issue_id, user_id));
alter table issue_photos enable row level security; alter table contact_attempts enable row level security; alter table confirmations enable row level security;
create policy "photos readable" on issue_photos for select using (true);
create policy "contacts readable" on contact_attempts for select using (true);
create policy "add photos" on issue_photos for insert with check (auth.uid() = uploaded_by);            -- the weak 001 policies 014 replaces
create policy "log contact" on contact_attempts for insert with check (auth.uid() = created_by);
create policy "see own confirmations" on confirmations for select using (auth.uid() = user_id);
create policy "confirm others only" on confirmations for insert with check (
  auth.uid() = user_id and not exists (select 1 from issues where id = issue_id and reporter_id = auth.uid()));
create function on_confirmation() returns trigger language plpgsql security definer as $$   -- the original from 001
begin
  update issues set confirmation_count = confirmation_count + 1,
         status = case when status = 'reported' and confirmation_count + 1 >= 3 then 'verified' else status end
   where id = new.issue_id;
  return new;
end $$;
create trigger trg_confirmation after insert on confirmations for each row execute function on_confirmation();

-- test helpers
create table results (n serial, name text, ok boolean);
grant all on results to public; grant all on sequence results_n_seq to public;
create function t(nm text, ok boolean) returns void language sql as $$ insert into results(name, ok) values (nm, coalesce(ok, false)) $$;
create function fails(q text, code text default null) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
create function works(q text) returns boolean language plpgsql as $$
begin execute q; return true; exception when others then raise notice 'unexpected: %', sqlerrm; return false; end $$;
create function uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function iid(n int) returns uuid language sql immutable as $$ select ('11111111-1111-1111-1111-' || lpad(n::text, 12, '0'))::uuid $$;
create function mkuser(n int, age interval, phone boolean default false) returns void language sql as
  $$ insert into auth.users(id, created_at, phone_confirmed_at) values (uid(n), now() - age, case when phone then now() end) $$;
create function mkissue(n int, reporter int) returns void language sql as
  $$ insert into issues(id, reporter_id, test_lat, test_lng) values (iid(n), uid(reporter), 5.6037, -0.1870) $$;
create function as_user(n int) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid(n)::text, false) $$;
-- one confirmation as user u on issue i, at an offset (degrees of latitude) from the report; null offset = no position sent
create function confirm_as(u int, i int, dlat double precision, claim boolean default null) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform as_user(u);
  insert into confirmations(issue_id, user_id, lat, lng, counts)
    values (iid(i), uid(u), case when dlat is null then null else 5.6037 + dlat end, case when dlat is null then null else -0.1870 end, coalesce(claim, true))
    returning counts into v;
  return v;
end $$;

-- a plain confirmation (no position), used before 015 exists
create function plain_confirm(u int, i int) returns void language plpgsql as $$
begin perform as_user(u); insert into confirmations(issue_id, user_id) values (iid(i), uid(u)); end $$;

-- people: 1 reporter (old), 2 reporter of a second report, 10-19 old accounts, 20 brand-new, 21 new with verified phone, 90 moderator
select mkuser(1, '2 days'), mkuser(2, '2 days'), mkuser(90, '2 days');
select mkuser(n, '1 hour') from generate_series(10, 19) n;
select mkuser(20, '1 minute'), mkuser(21, '1 minute', true), mkuser(30, '1 hour');
insert into moderators values (uid(90));
select mkissue(1, 1), mkissue(2, 2), mkissue(3, 1), mkissue(4, 1), mkissue(5, 1), mkissue(6, 1), mkissue(7, 1);
-- a confirmation that exists BEFORE 015 must keep counting afterwards
insert into confirmations(issue_id, user_id) values (iid(7), uid(30));

----------------------------------------------------------------------------------------------------------------
-- 014: forged photos and contact rows
\i 014_lock_down_photo_and_contact_inserts.sql
set role authenticated;
select as_user(10);
select t('014 stranger cannot add an AFTER photo to someone else''s report', fails(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'after',%L,%L)$q$, iid(1), uid(10)||'/x.jpg', uid(10))));
select t('014 stranger cannot add a BEFORE photo to someone else''s report', fails(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'before',%L,%L)$q$, iid(1), uid(10)||'/x.jpg', uid(10))));
select t('014 stranger cannot write the contact log', fails(format($q$insert into contact_attempts(issue_id,channel,response_received,created_by) values (%L,'phone',true,%L)$q$, iid(1), uid(10))));
select as_user(1);
select t('014 owner cannot point the photo at another user''s folder', fails(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'before',%L,%L)$q$, iid(1), uid(10)||'/x.jpg', uid(1))));
select t('014 owner cannot use ../ in the path', fails(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'before',%L,%L)$q$, iid(1), uid(1)||'/../'||uid(10)||'/x.jpg', uid(1))));
select t('014 owner cannot add an AFTER photo themselves', fails(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'after',%L,%L)$q$, iid(1), uid(1)||'/y.jpg', uid(1))));
select t('014 owner CAN add their own BEFORE photo in their own folder (what the app does)', works(format($q$insert into issue_photos(issue_id,kind,storage_path,uploaded_by) values (%L,'before',%L,%L)$q$, iid(1), uid(1)||'/'||iid(1)||'-before.jpg', uid(1))));
select t('014 photos stay publicly readable', (select count(*) from issue_photos) = 1);
reset role;

-- 016: contact-log notes
insert into contact_attempts(issue_id, channel, note, response_received) values (iid(1), 'whatsapp', 'private moderator note', false);
\i 016_contact_log_private_notes.sql
set role anon;
select t('016 public cannot read the contact note', fails('select note from contact_attempts'));
select t('016 public cannot read who logged the contact', fails('select created_by from contact_attempts'));
select t('016 public CAN read channel, response and date (what the page shows)', works('select channel, response_received, created_at from contact_attempts where issue_id = ' || quote_literal(iid(1))));
reset role;

----------------------------------------------------------------------------------------------------------------
-- 011 / 011b: the phone rules stay off unless asked
\i 011_phone_verified.sql
select t('011 installs both triggers but leaves them OFF', (select count(*) from pg_trigger where tgname in ('confirmations_need_phone','issues_need_phone') and tgenabled = 'D') = 2);
set role authenticated;
select t('011 (rules off) a brand-new unverified account can confirm', works('select plain_confirm(20, 1)'));
select as_user(1);
select t('011 (rules off) a second report inside 24h is allowed', works(format($q$insert into issues(id, reporter_id) values (%L,%L)$q$, iid(50), uid(1))));
reset role;
\i 011b_enable_phone_rules.sql
select t('011b switches both rules ON', (select count(*) from pg_trigger where tgname in ('confirmations_need_phone','issues_need_phone') and tgenabled = 'O') = 2);
set role authenticated;
select t('011b (rules on) an unverified account is refused with PV001', fails('select plain_confirm(10, 2)', 'PV001'));
select as_user(1);
select t('011b (rules on) a second report inside 24h is refused with PV001', fails(format($q$insert into issues(id, reporter_id) values (%L,%L)$q$, iid(51), uid(1)), 'PV001'));
select t('011b (rules on) a phone-verified account can confirm', works('select plain_confirm(21, 2)'));
select t('011b (rules on) a moderator can confirm', works('select plain_confirm(90, 2)'));
reset role;
\i 011_phone_verified.sql
select t('011 run again switches the rules back OFF (so setup_all.sql can never leave them on)', (select count(*) from pg_trigger where tgname in ('confirmations_need_phone','issues_need_phone') and tgenabled = 'D') = 2);

----------------------------------------------------------------------------------------------------------------
-- 015: confirmation quality
\i 015_confirmation_quality.sql
-- the real helper reads PostGIS; swap in a stand-in that reads the test columns (privileges are kept by CREATE OR REPLACE)
create or replace function issue_latlng(p_issue uuid, out lat double precision, out lng double precision)
language sql stable security definer as $$ select i.test_lat, i.test_lng from issues i where i.id = p_issue $$;

select t('015 a confirmation made before the migration still counts', (select counts from confirmations where user_id = uid(30) and issue_id = iid(7)));
select t('015 the exact-location helper is closed to the public and to signed-in users',
         not has_function_privilege('anon', 'issue_latlng(uuid)', 'execute') and not has_function_privilege('authenticated', 'issue_latlng(uuid)', 'execute'));

set role authenticated;
select t('015 old account, 300 m away: COUNTS', confirm_as(10, 3, 0.0027));
select t('015 old account, 900 m away: counts', confirm_as(11, 3, 0.0081));
select t('015 old account, 1.1 km away: does NOT count', not confirm_as(12, 3, 0.0099));
select t('015 old account, 5 km away: does NOT count', not confirm_as(13, 4, 0.05));
select t('015 old account, no position sent: does NOT count', not confirm_as(14, 4, null));
select t('015 old account, nonsense position: does not count, and no error', not confirm_as(15, 4, 999));
select t('015 brand-new account, right next to it: does NOT count', not confirm_as(20, 5, 0.0003));
select t('015 brand-new account with a verified phone, near: COUNTS', confirm_as(21, 5, 0.0003));
select t('015 the app cannot force a confirmation to count (claims counts=true from 5 km away)', not confirm_as(16, 5, 0.05, true));
select t('015 a moderator''s confirmation counts without a position', confirm_as(90, 6, null));
select t('015 the reporter still cannot confirm their own report', fails(format('select confirm_as(1, 1, 0.0)')));
reset role;

select t('015 the public number counts only counting confirmations (issue 3: two near = 2)', (select confirmation_count from issues where id = iid(3)) = 2);
select t('015 far or position-less confirmations leave the number alone (issue 4 = 0)', (select confirmation_count from issues where id = iid(4)) = 0);
select t('015 nothing about where anyone was is stored', (select count(*) from confirmations where lat is not null or lng is not null) = 0);

-- three real neighbours verify a report; two real neighbours plus one far-away account do not
set role authenticated;
select confirm_as(10, 6, 0.001), confirm_as(11, 6, 0.001);   -- plus the moderator above = 3 counting
reset role;
select t('015 three counting confirmations verify the report', (select status from issues where id = iid(6)) = 'verified');
set role authenticated;
select confirm_as(10, 5, 0.001), confirm_as(12, 5, 0.05);     -- issue 5 already has the phone-verified one; one more near, one far
reset role;
select t('015 two counting + one far-away confirmation do NOT verify (issue 5 = reported, 2)', (select status from issues where id = iid(5)) = 'reported' and (select confirmation_count from issues where id = iid(5)) = 2);

-- daily cap: 20 counting confirmations per account, the 21st records but does not count
insert into auth.users(id, created_at) values (uid(40), now() - interval '1 day');
insert into issues(id, reporter_id, test_lat, test_lng) select ('22222222-2222-2222-2222-' || lpad(g::text, 12, '0'))::uuid, uid(1), 5.6037, -0.1870 from generate_series(1, 21) g;
do $$
declare g int; v boolean; counted int := 0;
begin
  perform set_config('request.jwt.claim.sub', uid(40)::text, false);
  for g in 1..21 loop
    insert into confirmations(issue_id, user_id, lat, lng) values (('22222222-2222-2222-2222-' || lpad(g::text, 12, '0'))::uuid, uid(40), 5.6037, -0.1870) returning counts into v;
    if v then counted := counted + 1; end if;
  end loop;
  insert into results(name, ok) values ('015 daily cap: 20 count, the 21st is recorded but does not', counted = 20);
end $$;

----------------------------------------------------------------------------------------------------------------
-- 017: merge an anonymous phone's reports into the account it signs in to
create table flags (issue_id uuid references issues(id) on delete cascade, user_id uuid references auth.users(id),
  created_at timestamptz default now(), primary key (issue_id, user_id));
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, body text);
create table push_subscriptions (endpoint text primary key, user_id uuid not null references auth.users(id) on delete cascade);
create table notification_contacts (user_id uuid primary key references auth.users(id) on delete cascade, email text);
create table directory_suggestions (id uuid primary key default gen_random_uuid(), suggested_by uuid references auth.users(id) on delete set null);
create table tk (k text primary key, v text); grant all on tk to public;
create function ticket_for(n int, nm text) returns void language plpgsql as $$
begin perform as_user(n); insert into tk(k, v) values (nm, create_merge_ticket()) on conflict (k) do update set v = excluded.v; end $$;
create function claim_as(n int, nm text) returns int language plpgsql as $$
begin perform as_user(n); return (claim_merge_ticket((select tk.v from tk where tk.k = nm))->>'moved')::int; end $$;

-- 60 anonymous phone, 62 another anonymous phone, 61 and 64 real accounts with confirmed email, 63 account with an unconfirmed email
select mkuser(60, '3 days'), mkuser(61, '30 days'), mkuser(62, '3 days'), mkuser(63, '3 days'), mkuser(64, '30 days');
update auth.users set is_anonymous = true where id in (uid(60), uid(62));
update auth.users set email_confirmed_at = now() where id in (uid(61), uid(64));
select mkissue(60, 60), mkissue(61, 61);
select set_config('request.jwt.claim.sub', '', false);
insert into confirmations(issue_id, user_id) values (iid(61), uid(60)), (iid(2), uid(60)), (iid(2), uid(61)), (iid(4), uid(60)), (iid(60), uid(61));
insert into issue_photos(issue_id, kind, storage_path, uploaded_by) values (iid(60), 'before', uid(60) || '/a.jpg', uid(60));
insert into flags values (iid(2), uid(60)), (iid(2), uid(61)), (iid(4), uid(60));
insert into notifications(user_id, body) values (uid(60), 'hello');
insert into push_subscriptions values ('https://push/1', uid(60));
insert into notification_contacts values (uid(60), 'old@x.co'), (uid(61), 'keep@x.co');
insert into directory_suggestions(suggested_by) values (uid(60));
create table cc_before as select id, confirmation_count from issues where id in (iid(2), iid(4), iid(60), iid(61));

\i 017_merge_anonymous_reports.sql
select t('017 the two functions are closed to the public and open to signed-in visitors',
  not has_function_privilege('anon', 'create_merge_ticket()', 'execute') and not has_function_privilege('anon', 'claim_merge_ticket(text)', 'execute')
  and has_function_privilege('authenticated', 'create_merge_ticket()', 'execute') and has_function_privilege('authenticated', 'claim_merge_ticket(text)', 'execute'));
select t('017 nobody can read the ticket table', not has_table_privilege('anon', 'merge_tickets', 'select') and not has_table_privilege('authenticated', 'merge_tickets', 'select'));

set role authenticated;
select t('017 an account that already has an email cannot ask for a ticket', fails('select ticket_for(61, ''x'')'));
select set_config('request.jwt.claim.sub', '', false);
select t('017 nobody signed out can ask for a ticket', fails('select create_merge_ticket()'));
select t('017 an anonymous phone gets a ticket', works('select ticket_for(60, ''t60'')'));
select t('017 the ticket is long and random', (select length(v) = 64 from tk where k = 't60'));
reset role;
select t('017 only a fingerprint of the ticket is stored', (select count(*) from merge_tickets where token_hash = (select v from tk where k = 't60')) = 0 and (select count(*) from merge_tickets) = 1);
set role authenticated;
select as_user(61);
select t('017 a garbage ticket is refused for a real account', fails('select claim_merge_ticket(''nonsense'')'));
select t('017 an empty ticket is refused', fails('select claim_merge_ticket('''')') and fails('select claim_merge_ticket(null)'));
select as_user(63);
select t('017 an account whose email is not confirmed cannot claim', fails('select claim_as(63, ''t60'')'));
select as_user(62);
select t('017 another anonymous phone cannot claim it', fails('select claim_as(62, ''t60'')'));
select t('017 the failed attempts moved nothing', (select reporter_id from issues where id = iid(60)) = uid(60));

select t('017 the real account claims the ticket: 1 report moved', claim_as(61, 't60') = 1);
reset role;
select t('017 the report now belongs to the real account', (select reporter_id from issues where id = iid(60)) = uid(61));
select t('017 the photo moved', (select uploaded_by from issue_photos where issue_id = iid(60)) = uid(61));
select t('017 nothing is left on the old account', not exists (select 1 from issues where reporter_id = uid(60))
  and not exists (select 1 from confirmations where user_id = uid(60)) and not exists (select 1 from flags where user_id = uid(60))
  and not exists (select 1 from notifications where user_id = uid(60)) and not exists (select 1 from push_subscriptions where user_id = uid(60))
  and not exists (select 1 from notification_contacts where user_id = uid(60)) and not exists (select 1 from directory_suggestions where suggested_by = uid(60)));
select t('017 a confirmation on a report that is now their own is dropped (issue 60: 1 -> 0)', (select confirmation_count from issues where id = iid(60)) = (select confirmation_count - 1 from cc_before where id = iid(60)) and not exists (select 1 from confirmations where issue_id = iid(60)));
select t('017 the old account''s confirmation of their real account''s own report is dropped and uncounted (issue 61)', (select confirmation_count from issues where id = iid(61)) = (select confirmation_count - 1 from cc_before where id = iid(61)) and not exists (select 1 from confirmations where issue_id = iid(61)));
select t('017 a doubled confirmation is counted once (issue 2)', (select confirmation_count from issues where id = iid(2)) = (select confirmation_count - 1 from cc_before where id = iid(2)) and (select count(*) from confirmations where issue_id = iid(2) and user_id = uid(61)) = 1);
select t('017 a single confirmation moves and keeps counting (issue 4)', (select confirmation_count from issues where id = iid(4)) = (select confirmation_count from cc_before where id = iid(4)) and exists (select 1 from confirmations where issue_id = iid(4) and user_id = uid(61)));
select t('017 doubled flags collapse, single flags move', (select count(*) from flags where user_id = uid(61)) = 2);
select t('017 update notices and push alerts move', exists (select 1 from notifications where user_id = uid(61)) and exists (select 1 from push_subscriptions where user_id = uid(61)));
select t('017 the real account keeps its own update-email address', (select email from notification_contacts where user_id = uid(61)) = 'keep@x.co' and (select count(*) from notification_contacts) = 1);
select t('017 directory suggestions move', exists (select 1 from directory_suggestions where suggested_by = uid(61)));
set role authenticated;
select t('017 a ticket works only once', fails('select claim_as(61, ''t60'')'));
reset role;

-- expiry, and an old account that stopped being anonymous
select ticket_for(62, 't62') from (select set_config('request.jwt.claim.sub', uid(62)::text, false)) x;
update merge_tickets set expires_at = now() - interval '1 minute' where from_user = uid(62);
set role authenticated;
select t('017 an expired ticket is refused', fails('select claim_as(64, ''t62'')'));
reset role;
update merge_tickets set expires_at = now() + interval '1 hour' where from_user = uid(62);
update auth.users set is_anonymous = false where id = uid(62);
set role authenticated;
select t('017 a ticket from an account that is no longer plain anonymous is refused', fails('select claim_as(64, ''t62'')'));
reset role;
update auth.users set is_anonymous = true where id = uid(62);
set role authenticated;
select ticket_for(62, 't62b'); select ticket_for(62, 't62c');
reset role;
select t('017 only one live ticket per account', (select count(*) from merge_tickets where from_user = uid(62) and used_at is null) = 1);
set role authenticated;
select t('017 the replaced ticket no longer works', fails('select claim_as(64, ''t62b'')'));
select t('017 the newest ticket works', claim_as(64, 't62c') = 0);
reset role;

----------------------------------------------------------------------------------------------------------------
-- 018: spending limits for sign-in emails
\i 018_auth_email_throttle.sql
create function allowed(u int, e text, kind text default 'magiclink') returns text language sql as
  $$ select (r->>'allowed') || ':' || (r->>'reason') from (select allow_auth_email(uid(u), e, kind) r) x $$;
select t('018 only the email hook (service role) may call it',
  not has_function_privilege('anon', 'allow_auth_email(uuid,text,text)', 'execute') and not has_function_privilege('authenticated', 'allow_auth_email(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'allow_auth_email(uuid,text,text)', 'execute'));
select t('018 nobody can read the log', not has_table_privilege('anon', 'auth_email_log', 'select') and not has_table_privilege('authenticated', 'auth_email_log', 'select'));
select t('018 a resident gets 4 emails a day', allowed(70, 'a1@x.co') = 'true:ok' and allowed(70, 'a2@x.co') = 'true:ok' and allowed(70, 'a3@x.co') = 'true:ok' and allowed(70, 'a4@x.co') = 'true:ok');
select t('018 the 5th is refused for that account', allowed(70, 'a5@x.co') = 'false:user');
select t('018 a refused request is not logged', (select count(*) from auth_email_log where user_id = uid(70)) = 4);
select t('018 one address gets 3 emails a day from any accounts, spelled any way', allowed(71, 'Shared@x.co') = 'true:ok' and allowed(72, ' shared@X.co ') = 'true:ok' and allowed(73, 'shared@x.co') = 'true:ok');
select t('018 the 4th request for that address is refused', allowed(74, 'shared@x.co') = 'false:address');
select t('018 a moderator is always allowed', allowed(90, 'mod@x.co') = 'true:moderator');
select t('018 moderators ignore the personal and address limits', (select bool_and(allowed(90, 'shared@x.co') = 'true:moderator') from generate_series(1, 12)));
select t('018 moderator emails do not use up the resident allowance', (select count(*) from auth_email_log where resident) = 7);
insert into auth_email_log(user_id, to_hash, email_type, resident) select uid(1000 + g), 'h' || g, 'magiclink', true from generate_series(1, 23) g;
select t('018 when residents together reach 30 an hour, the next resident waits', allowed(80, 'late@x.co') = 'false:busy');
select t('018 and a moderator still gets through', allowed(90, 'mod2@x.co') = 'true:moderator');
update auth_email_log set created_at = now() - interval '2 hours' where resident;
select t('018 an hour later residents can ask again', allowed(80, 'late@x.co') = 'true:ok');
select t('018 the log keeps no email address', (select count(*) from auth_email_log where to_hash like '%@%') = 0 and (select count(*) from auth_email_log where to_hash = encode(sha256(convert_to('late@x.co', 'UTF8')), 'hex')) = 1);
insert into auth_email_log(user_id, to_hash, email_type, resident, created_at) values (uid(1), 'old', 'x', true, now() - interval '4 days');
select allowed(81, 'n@x.co');
select t('018 rows older than 3 days are deleted', (select count(*) from auth_email_log where to_hash = 'old') = 0);
delete from auth_email_log;
insert into auth_email_log(user_id, to_hash, email_type, resident, created_at) select uid(2000 + g), 'd' || g, 'x', true, now() - interval '5 hours' from generate_series(1, 300) g;
select t('018 300 a day for all residents is a hard cap, even when the last hour is quiet', allowed(82, 'cap@x.co') = 'false:busy' and allowed(90, 'cap2@x.co') = 'true:moderator');
delete from auth_email_log;
select t('018 an email with no known account is still handled', allow_auth_email(null, 'x@y.co', 'signup')->>'allowed' = 'true');

----------------------------------------------------------------------------------------------------------------
-- 019: "Is it fixed?"
create type issue_status as enum ('reported','verified','sent','in_progress','resolved','rejected');
drop policy "issues readable" on issues;
alter table issues alter column status drop default;
alter table issues alter column status type issue_status using status::issue_status;
alter table issues alter column status set default 'reported';
create policy "issues readable" on issues for select using (status <> 'rejected');
alter table issues add column resolved_at timestamptz, add column sent_at timestamptz, add column party_id uuid, add column duplicate_of uuid;
alter table notifications add column issue_id uuid, add column to_status text;
create table status_log (id bigint generated always as identity primary key, issue_id uuid, from_status issue_status, to_status issue_status not null,
  note text, actor uuid, created_at timestamptz default now());
create function on_status_change() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into status_log(issue_id, from_status, to_status, actor) values (new.id, old.status, new.status, auth.uid());
    if new.status = 'resolved' then new.resolved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger trg_status_before before update on issues for each row execute function on_status_change();

\i 019_fix_checks.sql
create trigger notify_status_change after insert on status_log for each row execute function notify_status_change();
-- re-run 017 now that fix_checks exists, so the merge covers it
\i 017_merge_anonymous_reports.sql

select mkuser(n, '30 days') from generate_series(100, 112) n;
create function mkresolved(n int, reporter int, with_party boolean default true) returns void language plpgsql as $$
begin
  perform mkissue(n, reporter);
  update issues set status = 'sent', sent_at = now() - interval '10 days', party_id = case when with_party then uid(900) end where id = iid(n);
  update issues set status = 'resolved' where id = iid(n);
  delete from status_log where issue_id = iid(n);
  delete from notifications where issue_id = iid(n);
end $$;
create function fixans(u int, n int, a text) returns jsonb language plpgsql as $$
begin perform as_user(u); return submit_fix_check(iid(n), a); end $$;
select set_config('request.jwt.claim.sub', '', false);

-- issue 100: reporter 100, confirmed by 101 and 102.  issue 101: nobody confirmed.  issue 102: no party.  issue 103: not resolved.
select mkresolved(100, 100), mkresolved(101, 100), mkresolved(102, 100, false);
select mkissue(103, 100);
insert into confirmations(issue_id, user_id) values (iid(100), uid(101)), (iid(100), uid(102)), (iid(102), uid(101)), (iid(103), uid(101));

select t('019 nobody can read who answered', not has_table_privilege('anon', 'fix_checks', 'select') and not has_table_privilege('authenticated', 'fix_checks', 'select'));
select t('019 the two functions are closed to the public',
  not has_function_privilege('anon', 'submit_fix_check(uuid,text)', 'execute') and not has_function_privilege('anon', 'my_fix_check(uuid)', 'execute')
  and has_function_privilege('authenticated', 'submit_fix_check(uuid,text)', 'execute'));
select t('019 the public totals list no user ids', (select count(*) from information_schema.columns where table_name = 'public_fix_checks' and column_name like '%user%') = 0);

set role authenticated;
select as_user(103);
select t('019 a stranger cannot answer', fails('select fixans(103, 100, ''not_fixed'')'));
select t('019 a stranger is told they are not eligible', (my_fix_check(iid(100))->>'eligible')::boolean = false);
select as_user(100);
select t('019 the reporter is eligible, with no answer yet', (my_fix_check(iid(100))->>'eligible')::boolean and my_fix_check(iid(100))->>'answer' is null);
select t('019 a report that is not resolved cannot be answered', fails('select fixans(100, 103, ''fixed'')'));
select t('019 a nonsense answer is refused', fails('select fixans(100, 100, ''maybe'')'));
select set_config('request.jwt.claim.sub', '', false);
select t('019 a signed-out visitor cannot answer', fails('select submit_fix_check(' || quote_literal(iid(100)) || ', ''fixed'')'));

select t('019 first answer ("fixed") does not reopen', (fixans(100, 100, 'fixed')->>'reopened')::boolean = false);
select t('019 one "not fixed" against one "fixed" does not reopen', (fixans(101, 100, 'not_fixed')->>'reopened')::boolean = false);
reset role;
select t('019 the totals show the round so far', (select (fixed, partly, not_fixed) = (1, 0, 1) from public_fix_checks where issue_id = iid(100)));
set role authenticated;
select t('019 a person can change their mind (101 now agrees it is fixed)', (fixans(101, 100, 'fixed')->>'reopened')::boolean = false);
select t('019 "partly" and "not fixed" together outnumbering "fixed" reopen it', (fixans(101, 100, 'not_fixed')->>'reopened')::boolean = false and (fixans(102, 100, 'partly')->>'reopened')::boolean);
reset role;
select t('019 reopened: back with the office, resolved date cleared, count up', (select status = 'sent' and resolved_at is null and reopen_count = 1 from issues where id = iid(100)));
select t('019 the original sent date is kept, so waiting time keeps counting', (select sent_at < now() - interval '9 days' from issues where id = iid(100)));
select t('019 the history says why', (select note from status_log where issue_id = iid(100) order by id desc limit 1) = 'reopened_by_neighbours');
select t('019 reporter and confirmers get a "reopened" notice and NO ordinary "sent" notice',
  (select count(*) from notifications where issue_id = iid(100) and to_status = 'reopened') = 3 and (select count(*) from notifications where issue_id = iid(100) and to_status = 'sent') = 0);
select t('019 the new round starts empty', (select (fixed, partly, not_fixed) = (0, 0, 0) from public_fix_checks where issue_id = iid(100)));
set role authenticated;
select as_user(100);
select t('019 while reopened, nobody can answer', (my_fix_check(iid(100))->>'eligible')::boolean = false and fails('select fixans(100, 100, ''fixed'')'));
reset role;

-- resolved again: a new round, answers from the first round do not count
update issues set status = 'resolved' where id = iid(100);
set role authenticated;
select t('019 in the new round the same person can answer again', (my_fix_check(iid(100))->>'eligible')::boolean and my_fix_check(iid(100))->>'answer' is null);
select fixans(100, 100, 'not_fixed');
select t('019 second reopening works', (fixans(101, 100, 'not_fixed')->>'reopened')::boolean);
reset role;
update issues set status = 'resolved' where id = iid(100);
set role authenticated;
select fixans(100, 100, 'not_fixed');
select t('019 after two automatic reopenings it no longer reopens by itself', (fixans(101, 100, 'not_fixed')->>'reopened')::boolean = false);
reset role;
select t('019 ...but the answers are still recorded', (select (not_fixed) = 2 from (select count(*) filter (where answer = 'not_fixed') as not_fixed from fix_checks where issue_id = iid(100) and cycle = 2) x));
set role authenticated;
reset role;
select t('019 reopen_count stops at 2', (select reopen_count = 2 and status = 'resolved' from issues where id = iid(100)));

-- only the reporter ever took part: one answer is enough
set role authenticated;
select t('019 reporter alone: a single "not fixed" reopens', (fixans(100, 101, 'not_fixed')->>'reopened')::boolean);
reset role;
set role authenticated;
select fixans(101, 102, 'fixed');
select t('019 (issue 102, no party) two disputes against one "fixed": a reopening lands on verified', (fixans(100, 102, 'not_fixed')->>'reopened')::boolean = false and (fixans(101, 102, 'not_fixed')->>'reopened')::boolean);
reset role;
select t('019 ...status is verified', (select status = 'verified' from issues where id = iid(102)));

-- the sign-in merge carries answers across
update issues set status = 'resolved' where id = iid(102);
select mkuser(113, '3 days'); update auth.users set is_anonymous = true where id = uid(113); update auth.users set email_confirmed_at = now() where id = uid(111);
insert into confirmations(issue_id, user_id) values (iid(102), uid(113));
set role authenticated;
select fixans(113, 102, 'fixed');
select ticket_for(113, 't113');
select t('019 merging an anonymous phone moves its answers', claim_as(111, 't113') = 0);
reset role;
select t('019 ...they now belong to the account signed in to', not exists (select 1 from fix_checks where user_id = uid(113)) and exists (select 1 from fix_checks where issue_id = iid(102) and user_id = uid(111) and cycle = 1));

----------------------------------------------------------------------------------------------------------------
-- 020: moderators see the totals
\i 020_admin_fix_checks.sql
select t('020 the public cannot call the moderator summary', not has_function_privilege('anon', 'admin_fix_check_summary()', 'execute'));
set role authenticated;
select as_user(100);
select t('020 an ordinary signed-in user is refused (42501)', fails('select * from admin_fix_check_summary()', '42501'));
select as_user(90);
select t('020 a moderator sees reopened reports with this round''s totals', exists (select 1 from admin_fix_check_summary() where issue_id = iid(100) and reopen_count = 2 and not_fixed = 2 and fixed = 0));
select t('020 reports nobody has answered, and never reopened, are left out', not exists (select 1 from admin_fix_check_summary() where issue_id = iid(1)));
select t('020 the summary carries no user ids', (select count(*) from pg_proc p, unnest(coalesce(p.proargnames, '{}')) a where p.proname = 'admin_fix_check_summary' and a like '%user%') = 0);
reset role;

----------------------------------------------------------------------------------------------------------------
\o
select case when ok then 'PASS' else 'FAIL' end as result, name from results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$ begin
  if exists (select 1 from results where not ok) then raise exception 'SOME CHECKS FAILED'; end if;
end $$;
