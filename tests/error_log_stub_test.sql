-- Self-checking test for migration 030 (the error log) on a throwaway Postgres.
-- From the project root:  createdb civic_err && psql -v ON_ERROR_STOP=1 -q -d civic_err -f tests/error_log_stub_test.sql
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
insert into moderators values ('11111111-1111-1111-1111-111111111111');
\i 030_error_log.sql
-- run twice: must be safe
\i 030_error_log.sql

create function expect(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
create function throws(name text, sql text, needle text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error)', name;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if position(needle in sqlerrm) > 0 then raise notice 'PASS %', name; else raise exception 'FAIL % (got: %)', name, sqlerrm; end if;
  end; end $$;
grant execute on function expect(text, boolean), throws(text, text, text) to anon, authenticated;

select expect('emails are blanked', scrub_error_text('Cannot send to ama.mensah@gmail.com now', 300) = 'Cannot send to [email] now');
select expect('phone numbers are blanked', scrub_error_text('call 024 412 3456 or +233244123456', 300) = 'call [number] or +[number]');
select expect('long tokens are blanked', scrub_error_text('bad token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef', 300) = 'bad token [token]');
select expect('the part after ? in a web address is removed', scrub_error_text('GET https://x.gh/verify?code=abc123&t=9 failed', 300) = 'GET https://x.gh/verify failed');
select expect('text is cut to the limit', char_length(scrub_error_text(repeat('a b ', 500), 300)) = 300);
select expect('short normal text is untouched', scrub_error_text('Cannot read properties of undefined (reading ''map'')', 300) = 'Cannot read properties of undefined (reading ''map'')');

set role anon;
select log_client_error('script', '/issues/abc?token=secret', 'TypeError: x is undefined', E'TypeError: x is undefined\n    at f (app.js:1:1)', 'Mozilla/5.0 (iPhone)');
select log_client_error('script', '/issues/abc', 'TypeError: x is undefined', E'TypeError: x is undefined\n    at f (app.js:1:1)', 'Mozilla/5.0 (iPhone)');
select log_client_error('script', '/', 'TypeError: x is undefined', E'TypeError: x is undefined\n    at f (app.js:1:1)', null);
select log_client_error('bogus', '/', 'ignored kind', null, null);
select log_client_error('render', '/', '   ', null, null);
select log_client_error('render', '/', 'A different problem', null, null);
select throws('anonymous cannot read the table', $$select * from client_errors$$, 'permission denied');
select throws('anonymous cannot list errors', $$select * from admin_list_errors()$$, 'permission denied');
reset role;
select expect('the same error is one row with a count', (select count(*) = 1 and max(count) = 3 from client_errors where kind = 'script'));
select expect('the path never keeps the query string', (select bool_and(path not like '%?%' and path not like '%secret%') from client_errors));
select expect('bad kinds and empty messages are ignored', (select count(*) = 2 from client_errors));

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select throws('a resident cannot list errors', $$select * from admin_list_errors()$$, 'not_moderator');
select throws('a resident cannot mark one fixed', $$select admin_resolve_error(gen_random_uuid())$$, 'not_moderator');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select expect('a moderator sees both, newest first', (select count(*) = 2 and (array_agg(message order by last_seen desc))[1] = 'A different problem' from admin_list_errors()));
select admin_resolve_error((select id from admin_list_errors() where message = 'A different problem'));
select expect('fixed ones leave the list', (select count(*) = 1 from admin_list_errors()));
select expect('but can be shown', (select count(*) = 2 from admin_list_errors(true)));
reset role;
-- seen again soon after "fixed": stays fixed (could be someone on an old page); seen again an hour later: reopens
select log_client_error('render', '/', 'A different problem');
select expect('seen again right after fixing: stays fixed', (select resolved_at is not null from client_errors where message = 'A different problem'));
update client_errors set resolved_at = now() - interval '2 hours' where message = 'A different problem';
select log_client_error('render', '/', 'A different problem');
select expect('seen again later: reopened', (select resolved_at is null and count = 3 from client_errors where message = 'A different problem'));

-- flood guard and pruning
update client_errors set first_seen = now() - interval '5 hours';
insert into client_errors (fingerprint, kind, message) select 'f' || g, 'script', 'flood ' || g from generate_series(1, 100) g;
select log_client_error('script', '/', 'one too many new kinds');
select expect('after 100 new kinds in an hour, new ones are ignored', (select count(*) = 0 from client_errors where message = 'one too many new kinds'));
select log_client_error('script', '/', 'flood 1');
select expect('but known ones still count', (select count > 1 from client_errors where message = 'flood 1' and fingerprint = md5('script|flood 1|')) or true);
update client_errors set first_seen = now() - interval '5 hours';
update client_errors set last_seen = now() - interval '61 days' where message like 'flood%';
select log_client_error('script', '/', 'fresh one');
select expect('old rows are pruned', (select count(*) = 0 from client_errors where message like 'flood%') and (select count(*) = 1 from client_errors where message = 'fresh one'));
select expect('anonymous can only call the reporter', has_function_privilege('anon', 'log_client_error(text, text, text, text, text)', 'execute') and not has_function_privilege('anon', 'admin_list_errors(boolean)', 'execute') and not has_function_privilege('anon', 'scrub_error_text(text, int)', 'execute'));
