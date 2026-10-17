-- Checks 008_directory.sql against a stand-in database. Run in a THROWAWAY database:
--   createdb civic_test3 && psql -v ON_ERROR_STOP=1 -d civic_test3 -f tests/directory_stub_test.sql
-- The stand-ins copy only what 008 relies on, including the two policies it removes or tightens
-- (public read of every column, and "suggest party"). It does not prove 008 fits your full schema.
\set ON_ERROR_STOP on

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create type party_type as enum ('community', 'contractor', 'government', 'private', 'utility');
create table regions (id uuid primary key default gen_random_uuid(), name text);
create table categories (id uuid primary key default gen_random_uuid(), name jsonb);
create table responsible_parties (
  id uuid primary key default gen_random_uuid(), name text not null, type party_type not null,
  region_id uuid references regions(id), email text, phone text, whatsapp text, notes text,
  verified boolean default false, created_by uuid references auth.users(id), created_at timestamptz default now());
create table category_responsibilities (
  id uuid primary key default gen_random_uuid(), category_id uuid not null references categories(id),
  region_id uuid not null references regions(id), party_id uuid not null references responsible_parties(id),
  unique (category_id, region_id, party_id));

-- the policies as they are live today
alter table responsible_parties enable row level security;
create policy "parties readable" on responsible_parties for select using (true);
create policy "suggest party" on responsible_parties for insert with check (true);
alter table category_responsibilities enable row level security;
create policy read on category_responsibilities for select using (true);
grant select, insert on responsible_parties to anon, authenticated;
grant select, insert, update, delete on category_responsibilities to anon, authenticated;

create function assert_moderator() returns void language plpgsql as $$
begin
  if coalesce(current_setting('app.is_mod', true), '') <> 'yes' then raise exception 'not_moderator'; end if;
end $$;

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

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222'), ('99999999-9999-9999-9999-999999999999');
insert into regions (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Greater Accra'), ('aaaaaaaa-0000-0000-0000-000000000002', 'Ashanti');
insert into categories (id, name) values ('cccccccc-0000-0000-0000-000000000001', '{"en":"Choked gutter"}'), ('cccccccc-0000-0000-0000-000000000002', '{"en":"Streetlight"}');
insert into responsible_parties (id, name, type, region_id, email, phone, whatsapp, notes, verified) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Accra Assembly', 'government', 'aaaaaaaa-0000-0000-0000-000000000001', 'old@assembly.gov', '0301111111', '233301111111', 'internal note', true);

-- 0. TODAY: anonymous visitors can read contacts and add parties (this is what 008 fixes)
set role anon;
do $$ begin assert (select email from responsible_parties limit 1) = 'old@assembly.gov', 'contacts readable before'; end $$;
insert into responsible_parties (name, type) values ('Fake Assembly', 'government');
reset role;
do $$ begin assert (select count(*) from responsible_parties where name = 'Fake Assembly') = 1, 'insert possible before'; end $$;
delete from responsible_parties where name = 'Fake Assembly';

\ir ../008_directory.sql

-- test-only: look up a suggestion id the way the app does (through a function, not the table)
create function sid(p_kind text default null, p_status text default 'pending', p_by uuid default null) returns uuid
language sql security definer as $$
  select id from public.directory_suggestions
  where (p_kind is null or kind = p_kind) and status = p_status and (p_by is null or suggested_by = p_by)
  order by created_at limit 1 $$;
grant execute on function sid(text, text, uuid) to anon, authenticated;

-- 1. AFTER: safe columns readable; contacts, notes and direct writes are not
set role anon;
do $$ begin assert (select count(*) from responsible_parties where verified) = 1, 'safe columns readable'; end $$;
select expect_error('select email from responsible_parties', 'permission denied');
select expect_error('select whatsapp from responsible_parties', 'permission denied');
select expect_error('select notes from responsible_parties', 'permission denied');
select expect_error('select created_by from responsible_parties', 'permission denied');
select expect_error('select * from responsible_parties', 'permission denied');
select expect_error($$insert into responsible_parties (name, type) values ('Fake Assembly', 'government')$$, 'permission denied');
select expect_error('select * from directory_suggestions', 'permission denied');
reset role;
set role authenticated;
select expect_error($$insert into responsible_parties (name, type) values ('Fake Assembly', 'government')$$, 'permission denied');
select expect_error($$insert into category_responsibilities (category_id, region_id, party_id) values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001')$$, 'permission denied');
do $$ begin assert (select count(*) from category_responsibilities) = 0, 'responsibilities still readable'; end $$;
reset role;

-- 2. validation
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select expect_error($$select suggest_directory_change('mystery')$$, 'bad_kind');
select expect_error($$select suggest_directory_change('new_party', null, 'X', 'government', 'aaaaaaaa-0000-0000-0000-000000000001', array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'bad_name');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', null, 'aaaaaaaa-0000-0000-0000-000000000002', array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'bad_type');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', null, array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'bad_region');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', gen_random_uuid(), array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'bad_region');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', 'aaaaaaaa-0000-0000-0000-000000000002')$$, 'no_categories');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', 'aaaaaaaa-0000-0000-0000-000000000002', array[gen_random_uuid()])$$, 'bad_category');
select expect_error($$select suggest_directory_change('new_party', null, 'accra assembly', 'government', 'aaaaaaaa-0000-0000-0000-000000000001', array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'already_listed');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', 'aaaaaaaa-0000-0000-0000-000000000002', array['cccccccc-0000-0000-0000-000000000001']::uuid[], 'nope')$$, 'bad_email');
select expect_error($$select suggest_directory_change('new_party', null, 'Kumasi Waste', 'government', 'aaaaaaaa-0000-0000-0000-000000000002', array['cccccccc-0000-0000-0000-000000000001']::uuid[], null, 'call me maybe')$$, 'bad_phone');
select expect_error($$select suggest_directory_change('correction', 'bbbbbbbb-0000-0000-0000-000000000001')$$, 'nothing_to_change');
select expect_error($$select suggest_directory_change('correction', gen_random_uuid(), 'New Name')$$, 'bad_party');
select expect_error($$select suggest_directory_change('correction', null, 'New Name')$$, 'bad_party');
select expect_error($$select suggest_directory_change('coverage', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, array['cccccccc-0000-0000-0000-000000000001']::uuid[])$$, 'bad_region');
select expect_error($$select suggest_directory_change('coverage', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, 'aaaaaaaa-0000-0000-0000-000000000001')$$, 'no_categories');
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'bad')$$, 'note_required');
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, repeat('x', 501))$$, 'note_too_long');
set app.uid = '';
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'closed down')$$, 'not_signed_in');
reset role;
do $$ begin assert (select count(*) from directory_suggestions) = 0, 'nothing stored by failed attempts'; end $$;
set role anon;
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'closed down')$$, 'permission denied');
reset role;

-- 3. a good suggestion of each kind; limits
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select suggest_directory_change('new_party', null, '  Kumasi Waste Dept ', 'government', 'aaaaaaaa-0000-0000-0000-000000000002',
  array['cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002']::uuid[],
  ' Waste@Kumasi.GOV ', '0322 000 000', '233322000000', 'found on their website');
select suggest_directory_change('correction', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', 'new@assembly.gov');
select suggest_directory_change('coverage', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, 'aaaaaaaa-0000-0000-0000-000000000001', array['cccccccc-0000-0000-0000-000000000002']::uuid[]);
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'closed down')$$, 'too_many_pending');
reset role;
do $$ begin
  assert (select count(*) from directory_suggestions) = 3, 'three stored';
  assert (select name from directory_suggestions where kind = 'new_party') = 'Kumasi Waste Dept', 'name trimmed';
  assert (select email from directory_suggestions where kind = 'new_party') = 'waste@kumasi.gov', 'email lower-cased';
  assert (select cardinality(category_ids) from directory_suggestions where kind = 'new_party') = 2, 'duplicate categories removed';
end $$;

-- 4. moderator list: sees contacts and the current entry; others cannot
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select expect_error('select admin_list_suggestions()', 'not_moderator');
select expect_error($$select admin_review_suggestion(gen_random_uuid(), true)$$, 'not_moderator');
set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
do $$ declare l jsonb; begin
  l := admin_list_suggestions();
  assert jsonb_array_length(l) = 3, 'three pending';
  assert (select x->>'email' from jsonb_array_elements(l) x where x->>'kind' = 'new_party') = 'waste@kumasi.gov', 'moderator sees contacts';
  assert (select x->'current'->>'email' from jsonb_array_elements(l) x where x->>'kind' = 'correction') = 'old@assembly.gov', 'current entry beside it';
  assert (select jsonb_typeof(x->'current') from jsonb_array_elements(l) x where x->>'kind' = 'new_party') = 'null', 'no current entry for a new party';
end $$;

-- 5. approve each kind
select admin_review_suggestion(sid('new_party'), true);
select admin_review_suggestion(sid('correction'), true);
select admin_review_suggestion(sid('coverage'), true);
reset role; reset app.is_mod;
do $$ begin
  assert (select count(*) from responsible_parties where name = 'Kumasi Waste Dept' and verified and created_by = '99999999-9999-9999-9999-999999999999' and whatsapp = '233322000000') = 1, 'new party created, verified, by the moderator';
  assert (select count(*) from category_responsibilities c join responsible_parties p on p.id = c.party_id where p.name = 'Kumasi Waste Dept') = 2, 'its two problem types';
  assert (select email from responsible_parties where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'new@assembly.gov', 'email corrected';
  assert (select phone from responsible_parties where id = 'bbbbbbbb-0000-0000-0000-000000000001') = '0301111111', 'phone untouched';
  assert (select name from responsible_parties where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'Accra Assembly', 'name untouched';
  assert (select count(*) from category_responsibilities where party_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1, 'coverage added';
  assert (select count(*) from directory_suggestions where status = 'approved') = 3, 'marked approved';
  assert (select count(*) from directory_suggestions where email is not null or phone is not null or whatsapp is not null) = 0, 'contact details wiped from suggestions';
end $$;

-- 6. the same coverage again adds nothing; wrong approves to unverified and stops matching; reject changes nothing
set role authenticated; set app.uid = '22222222-2222-2222-2222-222222222222';
select suggest_directory_change('coverage', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, 'aaaaaaaa-0000-0000-0000-000000000001', array['cccccccc-0000-0000-0000-000000000002']::uuid[]);
select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'This office moved and the number is dead');
select suggest_directory_change('correction', 'bbbbbbbb-0000-0000-0000-000000000001', 'Totally Different Name', null, null, '{}', 'spam@example.com', '0300000000');
set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
select admin_review_suggestion(sid('coverage'), true);
reset role; reset app.is_mod;
do $$ begin assert (select count(*) from category_responsibilities where party_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1, 'no duplicate coverage'; end $$;
set role authenticated; set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
select admin_review_suggestion(sid('correction'), false, '  not credible ');
select admin_review_suggestion(sid('wrong'), true);
reset role; reset app.is_mod;
do $$ begin
  assert (select name from responsible_parties where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'Accra Assembly', 'rejected change not applied';
  assert (select verified from responsible_parties where id = 'bbbbbbbb-0000-0000-0000-000000000001') = false, 'wrong => unverified';
  assert (select count(*) from category_responsibilities where party_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0, 'wrong => no automatic matching';
  assert (select review_note from directory_suggestions where status = 'rejected') = 'not credible', 'review note stored, trimmed';
  assert (select phone is null and email is null from directory_suggestions where status = 'rejected'), 'rejected contact details wiped';
end $$;

-- 7. the public sees only what is verified; reviewed suggestions cannot be reviewed twice
set role anon;
do $$ begin assert (select count(*) from responsible_parties where verified) = 1, 'unverified one is hidden from verified-only readers'; end $$;
reset role;
set role authenticated; set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
select expect_error($$select admin_review_suggestion(sid('wrong', 'approved'), true)$$, 'already_reviewed');
select expect_error($$select admin_review_suggestion(gen_random_uuid(), true)$$, 'suggestion_not_found');
reset role; reset app.is_mod;

-- 8. people see the outcome of their own suggestions only, without contact details
set role authenticated; set app.uid = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from my_directory_suggestions()) = 3, 'u2 sees own three';
  assert (select status from my_directory_suggestions() where kind = 'correction') = 'rejected', 'rejected shown';
  assert (select review_note from my_directory_suggestions() where kind = 'correction') = 'not credible', 'reason shown';
end $$;
set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin assert (select count(*) from my_directory_suggestions() where kind in ('correction', 'wrong') ) = 1, 'u1 sees only own'; end $$;
reset role;

-- 9. the daily limit: u1 already sent 3 today; two more is fine, a sixth is refused
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'still wrong, call failed');
reset role;
set role authenticated; set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
select admin_review_suggestion(sid(null, 'pending', '11111111-1111-1111-1111-111111111111'), false);
reset role; reset app.is_mod;
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'one more report');
reset role;
set role authenticated; set app.uid = '99999999-9999-9999-9999-999999999999'; set app.is_mod = 'yes';
select admin_review_suggestion(sid(null, 'pending', '11111111-1111-1111-1111-111111111111'), false);
reset role; reset app.is_mod;
set role authenticated; set app.uid = '11111111-1111-1111-1111-111111111111';
select expect_error($$select suggest_directory_change('wrong', 'bbbbbbbb-0000-0000-0000-000000000001', null, null, null, '{}', null, null, null, 'sixth today')$$, 'too_many');
reset role;

\echo 'directory: all checks passed'
