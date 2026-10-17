-- Checks 006_issue_links.sql against a stand-in database. Run in a THROWAWAY database:
--   createdb civic_test && psql -v ON_ERROR_STOP=1 -d civic_test -f tests/issue_links_stub_test.sql
-- The stand-ins copy only what 006 relies on (issues.id, the issue_links table and its read policy,
-- assert_moderator). It does not prove 006 works with your full schema; running 006 live does that.
\set ON_ERROR_STOP on

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

create table issues (id uuid primary key default gen_random_uuid());
create table issue_links (
  issue_a uuid not null references issues(id) on delete cascade,
  issue_b uuid not null references issues(id) on delete cascade,
  relation text default 'related',
  primary key (issue_a, issue_b),
  check (issue_a <> issue_b)
);
alter table issue_links enable row level security;
create policy read on issue_links for select using (true);
grant select on issue_links to anon, authenticated;

create function assert_moderator() returns void language plpgsql as $$
begin
  if coalesce(current_setting('app.is_mod', true), '') <> 'yes' then raise exception 'not_moderator'; end if;
end $$;

\ir ../006_issue_links.sql

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

insert into issues (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');
grant execute on function expect_error(text, text) to authenticated, anon;

-- 1. a signed-in user who is not a moderator is refused
set role authenticated;
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')$$, 'not_moderator');

-- 2. a moderator links in either order; one row is stored, smaller id first
set app.is_mod = 'yes';
select admin_link_issues('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from issue_links) = 1, 'one row after first link';
  assert (select issue_a from issue_links) = '00000000-0000-0000-0000-00000000000a', 'smaller id first';
  assert (select relation from issue_links) = 'related', 'default relation';
end $$;

-- 3. linking again, other order, changes the relation instead of adding a row
select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','duplicate');
do $$ begin
  assert (select count(*) from issue_links) = 1, 'still one row';
  assert (select relation from issue_links) = 'duplicate', 'relation updated';
end $$;

-- 4. bad input is refused with a clear message
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a')$$, 'same_issue');
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a',null)$$, 'same_issue');
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c','friend')$$, 'bad_relation');
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000ff')$$, 'issue_not_found');

-- 5. unlink works with the ids in either order
select admin_unlink_issues('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from issue_links) = 0, 'unlinked'; end $$;
reset role;

-- 6. an old row stored the other way round is replaced, not duplicated
insert into issue_links (issue_a, issue_b) values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a');
set role authenticated; set app.is_mod = 'yes';
select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c','duplicate');
do $$ begin
  assert (select count(*) from issue_links) = 1, 'reverse row replaced';
  assert (select issue_a from issue_links) = '00000000-0000-0000-0000-00000000000a', 'normalised order';
end $$;
reset role;

-- 7. anonymous visitors can read links but cannot call the admin functions or write directly
set role anon;
do $$ begin assert (select count(*) from issue_links) = 1, 'anon can read'; end $$;
select expect_error($$select admin_link_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
select expect_error($$select admin_unlink_issues('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c')$$, 'permission denied');
select expect_error($$insert into issue_links (issue_a, issue_b) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
reset role;

\echo 'issue_links: all checks passed'
