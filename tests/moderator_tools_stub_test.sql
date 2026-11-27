-- Self-checking test for migration 028 (bulk actions and the moderator record) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_mod && psql -v ON_ERROR_STOP=1 -q -d civic_mod -f tests/moderator_tools_stub_test.sql
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text);
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create type issue_status as enum ('reported','verified','sent','in_progress','resolved','rejected');
create table moderators (user_id uuid primary key);
create function is_moderator() returns boolean language sql stable security definer as $$ select exists (select 1 from moderators where user_id = auth.uid()) $$;
create function assert_moderator() returns void language plpgsql as $$ begin if not is_moderator() then raise exception 'not_moderator' using errcode='42501'; end if; end $$;
create table responsible_parties (id uuid primary key default gen_random_uuid(), name text);
create table issues (id uuid primary key, status issue_status default 'reported', party_id uuid, category_id uuid, duplicate_of uuid);
create table issue_photos (issue_id uuid, kind text);
create table flags (issue_id uuid, user_id uuid, reason text);
create table office_replies (id uuid primary key default gen_random_uuid(), issue_id uuid, removed_at timestamptz);
create table office_staff (id uuid primary key default gen_random_uuid(), email text, party_id uuid, revoked_at timestamptz);
-- the real functions from 005, reduced to the rules that matter here
create function admin_set_status(p_issue uuid, p_status issue_status, p_note text default null) returns void language plpgsql security definer as $$
declare v_old issue_status; v_party uuid;
begin perform assert_moderator();
  select status, party_id into v_old, v_party from issues where id = p_issue;
  if not found then raise exception 'not_found'; end if;
  if v_old = p_status then return; end if;
  if p_status = 'sent' and v_party is null then raise exception 'party_required'; end if;
  if p_status = 'resolved' and not exists (select 1 from issue_photos where issue_id = p_issue and kind = 'after') then raise exception 'after_photo_required'; end if;
  update issues set status = p_status where id = p_issue; end $$;
create function admin_assign_party(p_issue uuid, p_party uuid, p_remember boolean default true) returns void language plpgsql security definer as $$
begin perform assert_moderator(); update issues set party_id = p_party where id = p_issue; end $$;
create function admin_dismiss_flags(p_issue uuid) returns void language plpgsql security definer as $$
begin perform assert_moderator(); delete from flags where issue_id = p_issue; end $$;

insert into moderators values ('11111111-1111-1111-1111-111111111111');
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'mod@x.gh'), ('22222222-2222-2222-2222-222222222222', 'resident@x.gh');
insert into responsible_parties (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Ga East');
insert into issues (id, status, party_id) values
  ('00000000-0000-0000-0000-000000000001', 'reported', null),
  ('00000000-0000-0000-0000-000000000002', 'reported', null),
  ('00000000-0000-0000-0000-000000000003', 'reported', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000004', 'sent', '00000000-0000-0000-0000-0000000000a1');
insert into flags values ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'spam'),
                         ('00000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'fake');
\i 028_moderator_tools.sql
-- run twice: must be safe
\i 028_moderator_tools.sql

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;

-- a resident changing things is not recorded
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('a resident cannot read the record', $$select * from admin_activity()$$, 'not_moderator');
select throws('a resident cannot bulk change', $$select * from admin_bulk_set_status(array['00000000-0000-0000-0000-000000000001']::uuid[], 'rejected')$$, 'not_moderator');
select throws('nobody can read the table directly', $$select * from moderator_log$$, 'permission denied');
reset role;
select expect('anonymous cannot call the functions', not has_function_privilege('anon', 'admin_bulk_set_status(uuid[], issue_status, text)', 'execute') and not has_function_privilege('anon', 'admin_activity(int, uuid)', 'execute'));
select expect('the internal writer is not callable by the app', not has_function_privilege('authenticated', 'log_moderator(text, uuid, jsonb)', 'execute'));
update issues set status = 'verified' where id = '00000000-0000-0000-0000-000000000003';   -- a non-moderator / system change
select expect('changes by non-moderators are not logged', (select count(*) = 0 from moderator_log));

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;

-- bulk reject two reports
select expect('bulk reject works on all selected', (select count(*) = 2 and bool_and(ok) from admin_bulk_set_status(array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']::uuid[], 'rejected', null)));
select expect('both are rejected', (select count(*) = 2 from issues where status = 'rejected'));
-- one fails, the others still go through
select expect('a failing report does not undo the rest',
  (select count(*) filter (where ok) = 1 and count(*) filter (where not ok and error = 'party_required') = 1
     from admin_bulk_set_status(array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003']::uuid[], 'sent', null)));
select expect('resolved still needs an after photo, report by report',
  (select bool_and(not ok and error = 'after_photo_required') from admin_bulk_set_status(array['00000000-0000-0000-0000-000000000004']::uuid[], 'resolved', null)));
select expect('duplicates in the selection are handled once', (select count(*) = 1 from admin_bulk_set_status(array['00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004']::uuid[], 'in_progress', null)));
select throws('empty selection is refused', $$select * from admin_bulk_set_status(array[]::uuid[], 'rejected')$$, 'nothing_selected');
select throws('more than 50 is refused', $$select * from admin_bulk_set_status((select array_agg(gen_random_uuid()) from generate_series(1, 51)), 'rejected')$$, 'too_many');

-- bulk assign and dismiss
select expect('bulk assign works', (select bool_and(ok) from admin_bulk_assign_party(array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']::uuid[], '00000000-0000-0000-0000-0000000000a1')));
select throws('assigning to an unknown office is refused', $$select * from admin_bulk_assign_party(array['00000000-0000-0000-0000-000000000001']::uuid[], gen_random_uuid())$$, 'party_not_found');
select expect('a missing report is reported, not fatal', (select bool_and(not ok and error = 'not_found') from admin_bulk_assign_party(array[gen_random_uuid()], '00000000-0000-0000-0000-0000000000a1')));
select expect('bulk dismiss clears the flags', (select bool_and(ok) from admin_bulk_dismiss_flags(array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']::uuid[])));
reset role;
select expect('flags are gone', (select count(*) = 0 from flags));

-- the record
set role authenticated;
select expect('status changes are recorded with who and from/to',
  (select count(*) = 4 from admin_activity() where action = 'status' and moderator_email = 'mod@x.gh' and detail ? 'from' and detail ? 'to'));
select expect('assignments are recorded', (select count(*) = 2 from admin_activity() where action = 'assign_office'));
select expect('dismissed flags are recorded', (select count(*) = 2 from admin_activity() where action = 'dismiss_flags'));
select expect('actions from one bulk call share a batch id',
  (select count(distinct detail->>'batch') = 1 from admin_activity() where action = 'dismiss_flags' and detail ? 'batch'));
select expect('different bulk calls have different batch ids', (select count(distinct detail->>'batch') >= 3 from admin_activity() where detail ? 'batch'));
select expect('newest first', (select id = (select max(a.id) from admin_activity() a) from admin_activity() limit 1));
select expect('filter by report', (select count(*) > 0 and bool_and(issue_id = '00000000-0000-0000-0000-000000000001') from admin_activity(100, '00000000-0000-0000-0000-000000000001')));
select expect('limit is respected', (select count(*) = 2 from admin_activity(2)));

-- single actions and the other triggers
select admin_set_status('00000000-0000-0000-0000-000000000004', 'rejected');
select expect('a single status change is recorded without a batch', (select count(*) = 1 from admin_activity() where action = 'status' and not detail ? 'batch' and detail->>'to' = 'rejected'));
reset role;
insert into office_replies (id, issue_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000004');
insert into office_staff (id, email, party_id) values ('00000000-0000-0000-0000-0000000000c1', 'staff@ga.gov.gh', '00000000-0000-0000-0000-0000000000a1');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
update office_replies set removed_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
update office_staff set revoked_at = now() where id = '00000000-0000-0000-0000-0000000000c1';
select expect('hiding a reply is recorded', (select count(*) = 1 from admin_activity() where action = 'hide_reply'));
select expect('revoking staff is recorded', (select count(*) = 1 from admin_activity() where action = 'revoke_staff' and detail->>'email' = 'staff@ga.gov.gh'));
reset role;
select expect('the record cannot be edited by the app', not has_table_privilege('authenticated', 'moderator_log', 'update') and not has_table_privilege('authenticated', 'moderator_log', 'delete'));
