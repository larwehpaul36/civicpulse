-- Self-checking test for migration 025 (office reply links, on top of 021 and 022) on a throwaway Postgres (no PostGIS needed).
-- From the project root:  createdb civic_links && psql -v ON_ERROR_STOP=1 -q -d civic_links -f tests/reply_links_stub_test.sql
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
create table issues (id uuid primary key, status text default 'sent', party_id uuid, reporter_id uuid);
create table confirmations (issue_id uuid, user_id uuid);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, issue_id uuid not null, to_status text not null,
  created_at timestamptz default now(), read_at timestamptz);
alter table issues enable row level security;
create policy "issues readable" on issues for select using (status <> 'rejected');
grant select on issues, responsible_parties to anon, authenticated;

insert into responsible_parties (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Test Assembly');
insert into issues (id, status, party_id) values
  ('00000000-0000-0000-0000-000000000001', 'sent', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000002', 'reported', null),
  ('00000000-0000-0000-0000-000000000003', 'rejected', '00000000-0000-0000-0000-0000000000a1');
insert into moderators values ('11111111-1111-1111-1111-111111111111');
update issues set reporter_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000001';
insert into confirmations values ('00000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
                                 ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');  -- reporter confirmed too: still one notice


alter table issues add column category_id uuid, add column description text, add column created_at timestamptz default now(), add column sent_at timestamptz;  -- the real table has these

\i 021_office_replies.sql
\i 022_office_reply_notices.sql
\i 025_office_reply_links.sql
\i 025_office_reply_links.sql   -- twice: must be safe

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;
create table toks (n serial, tok text);
grant usage on sequence toks_n_seq to anon, authenticated;

-- ---------------- the moderator makes links
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into toks (tok) select admin_make_reply_link('00000000-0000-0000-0000-000000000001');
select expect('moderator gets a 64-character secret', (select length(tok) = 64 and tok ~ '^[0-9a-f]+$' from toks where n = 1));
select throws('report with no office', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000002')$q$, 'no_party');
select throws('rejected report', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000003')$q$, 'issue_not_found');
select throws('unknown report', $q$select admin_make_reply_link('00000000-0000-0000-0000-0000000000ff')$q$, 'issue_not_found');
select throws('lifetime of 0 days', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000001', 0)$q$, 'bad_days');
select throws('lifetime over 60 days', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000001', 61)$q$, 'bad_days');
reset role;
select expect('only a hash is stored, never the secret',
  (select count(*) = 1 from office_reply_links where token_hash = reply_token_hash((select tok from toks where n = 1)))
  and not exists (select 1 from office_reply_links where token_hash = (select tok from toks where n = 1)));

-- ---------------- a visitor with the link
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select expect('the page can load what it needs', (select party_name = 'Test Assembly' and status = 'sent' from office_link_info((select tok from toks where n = 1))));
select expect('a made-up link shows nothing', (select count(*) = 0 from office_link_info('nonsense')));
select expect('an empty link shows nothing', (select count(*) = 0 from office_link_info('')) and (select count(*) = 0 from office_link_info(null)));
select throws('anon cannot read the link table', 'select token_hash from office_reply_links', 'permission denied');
select throws('anon cannot make links', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000001')$q$, 'permission denied');
select throws('anon cannot revoke links', $q$select admin_revoke_reply_links('00000000-0000-0000-0000-000000000001')$q$, 'permission denied');
select throws('anon cannot call the hash helper', $q$select reply_token_hash('x')$q$, 'permission denied');

select expect('a reply through the link is accepted', office_reply_via_link((select tok from toks where n = 1), 'reply', '  We will send a crew on Friday.  ') is not null);
select expect('a date through the link is accepted', office_reply_via_link((select tok from toks where n = 1), 'expected_date', null, current_date + 5) is not null);
select expect('not-ours through the link is accepted', office_reply_via_link((select tok from toks where n = 1), 'not_ours', 'Water company pipe.') is not null);
select throws('wrong link', $q$select office_reply_via_link('nonsense', 'reply', 'x')$q$, 'link_invalid');
select throws('empty link', $q$select office_reply_via_link('', 'reply', 'x')$q$, 'link_invalid');
select throws('null link', $q$select office_reply_via_link(null, 'reply', 'x')$q$, 'link_invalid');
select throws('bad kind', format($q$select office_reply_via_link(%L, 'shout', 'x')$q$, (select tok from toks where n = 1)), 'bad_kind');
select throws('empty text', format($q$select office_reply_via_link(%L, 'reply', '   ')$q$, (select tok from toks where n = 1)), 'text_required');
select throws('over 500', format($q$select office_reply_via_link(%L, 'reply', %L)$q$, (select tok from toks where n = 1), repeat('x', 501)), 'too_long');
select throws('date missing', format($q$select office_reply_via_link(%L, 'expected_date')$q$, (select tok from toks where n = 1)), 'date_required');
select throws('date in the past', format($q$select office_reply_via_link(%L, 'expected_date', null, current_date - 1)$q$, (select tok from toks where n = 1)), 'bad_date');
select throws('date too far', format($q$select office_reply_via_link(%L, 'expected_date', null, current_date + 400)$q$, (select tok from toks where n = 1)), 'bad_date');
select office_reply_via_link((select tok from toks where n = 1), 'reply', 'with a stray date', current_date + 3);
select expect('a stray date on a plain reply is dropped', (select expected_date is null from office_replies where body = 'with a stray date'));
select expect('the reply is public, labelled as coming from a link, trimmed, and tied to the right office',
  (select count(*) = 1 from office_replies where source = 'link' and body = 'We will send a crew on Friday.' and party_id = '00000000-0000-0000-0000-0000000000a1'));
select throws('the public cannot see who made a reply (relayed_by)', 'select relayed_by from office_replies', 'permission denied');
reset role;
select expect('a link reply records no moderator', (select bool_and(relayed_by is null) from office_replies where source = 'link'));
select expect('followers were notified, once each (022 still works)', (select count(*) = 2 from notifications where to_status = 'office_reply'));

-- ---------------- the daily limit (5 per report per day; 5 so far: reply, date, not_ours, stray date = 4)
set role anon;
select office_reply_via_link((select tok from toks where n = 1), 'reply', 'fifth');
select throws('the sixth reply in a day is refused', format($q$select office_reply_via_link(%L, 'reply', 'sixth')$q$, (select tok from toks where n = 1)), 'rate_limited');
reset role;
update office_replies set created_at = now() - interval '2 days' where source = 'link';
set role anon;
select expect('the limit resets the next day', office_reply_via_link((select tok from toks where n = 1), 'reply', 'next day') is not null);
reset role;

-- ---------------- expiry and revoking
update office_reply_links set expires_at = now() - interval '1 minute';
set role anon;
select expect('an expired link shows nothing', (select count(*) = 0 from office_link_info((select tok from toks where n = 1))));
select throws('an expired link cannot reply', format($q$select office_reply_via_link(%L, 'reply', 'late')$q$, (select tok from toks where n = 1)), 'link_invalid');
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into toks (tok) select admin_make_reply_link('00000000-0000-0000-0000-000000000001', 7);
reset role;
select expect('the new link lives about 7 days', (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
  from office_reply_links order by created_at desc limit 1));
set role authenticated;
select expect('revoking switches off the live links and says how many', admin_revoke_reply_links('00000000-0000-0000-0000-000000000001') = 1);
reset role;
set role anon;
select throws('a revoked link cannot reply', format($q$select office_reply_via_link(%L, 'reply', 'x')$q$, (select tok from toks where n = 2)), 'link_invalid');
reset role;

-- ---------------- only the 5 newest live links are kept
update office_reply_links set revoked_at = now() where revoked_at is null;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select admin_make_reply_link('00000000-0000-0000-0000-000000000001') from generate_series(1, 7);
reset role;
select expect('seven links made, five kept live', (select count(*) = 5 from office_reply_links where issue_id = '00000000-0000-0000-0000-000000000001' and revoked_at is null));
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
reset role;

-- ---------------- residents
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('a resident cannot make a link', $q$select admin_make_reply_link('00000000-0000-0000-0000-000000000001')$q$, 'not_moderator');
select throws('a resident cannot revoke links', $q$select admin_revoke_reply_links('00000000-0000-0000-0000-000000000001')$q$, 'not_moderator');
select throws('a resident cannot read the table', 'select token_hash from office_reply_links', 'permission denied');
reset role;

-- ---------------- a link to a report that is later rejected stops working
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into toks (tok) select admin_make_reply_link('00000000-0000-0000-0000-000000000001');
reset role;
update issues set status = 'rejected' where id = '00000000-0000-0000-0000-000000000001';
set role anon;
select expect('a rejected report no longer shows on the link page', (select count(*) = 0 from office_link_info((select tok from toks order by n desc limit 1))));
select throws('and no longer takes replies', format($q$select office_reply_via_link(%L, 'reply', 'x')$q$, (select tok from toks order by n desc limit 1)), 'link_invalid');
reset role;
\echo ALL LINK CHECKS RAN
