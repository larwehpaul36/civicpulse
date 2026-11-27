-- 030: error log. Run after 029. Safe to run twice. Free: no outside service, nothing to install.
-- When the app breaks on someone's phone, the page sends a short, cleaned-up note here, and moderators see it in the Errors tab.
--   * One row per kind of error (a fingerprint), with a count and first/last time, so one bug seen 500 times is one line.
--   * No user id, no IP address, no full web address (the path only, never the part after ?). Emails, long numbers and
--     long codes inside messages are blanked before saving. Rows older than 60 days are deleted.
--   * Anyone can send a note (the app must be able to report even when nobody is signed in), but only 100 new kinds of error per hour are accepted overall, and each text is cut short, so it cannot fill the database.
--   * Only moderators can read or mark them fixed. The table is private.

create table if not exists client_errors (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  kind        text not null check (kind in ('render', 'script', 'promise', 'report')),
  path        text,
  message     text not null,
  stack       text,
  agent       text,
  count       int  not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists client_errors_seen_idx on client_errors (last_seen desc);
alter table client_errors enable row level security;
revoke all on client_errors from anon, authenticated;

-- Blank out anything personal that could be inside an error message.
create or replace function public.scrub_error_text(p text, p_max int)
returns text language sql immutable as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p, ''), '[^\s@<>"'']+@[^\s@<>"'']+\.[^\s@<>"'']+', '[email]', 'g'),   -- emails
          '[A-Za-z0-9_\-\.=]{32,}', '[token]', 'g'),                                                     -- long codes and tokens
        '\d[\d\s\-]{7,}\d', '[number]', 'g'),                                                           -- phone-like numbers
      '\?[^\s)"'']*', '', 'g'),                                                                         -- anything after a ? in a web address
    p_max);
$$;

create or replace function public.log_client_error(p_kind text, p_path text, p_message text, p_stack text default null, p_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_msg text := scrub_error_text(p_message, 300); v_stack text := scrub_error_text(p_stack, 800);
        v_path text := left(split_part(coalesce(p_path, ''), '?', 1), 200); v_fp text;
begin
  if p_kind is null or p_kind not in ('render', 'script', 'promise', 'report') or btrim(v_msg) = '' then return; end if;
  v_fp := md5(p_kind || '|' || v_msg || '|' || left(split_part(v_stack, E'\n', 2), 160));
  update client_errors set count = count + 1, last_seen = now(),
         resolved_at = case when resolved_at is not null and resolved_at < now() - interval '1 hour' then null else resolved_at end   -- seen again after "fixed": reopen
   where fingerprint = v_fp;
  if found then return; end if;
  if (select count(*) from client_errors where first_seen > now() - interval '1 hour') >= 100 then return; end if;   -- LIMIT: new kinds per hour, overall
  delete from client_errors where last_seen < now() - interval '60 days';
  insert into client_errors (fingerprint, kind, path, message, stack, agent)
  values (v_fp, p_kind, nullif(v_path, ''), v_msg, nullif(v_stack, ''), nullif(left(coalesce(p_agent, ''), 120), ''))
  on conflict (fingerprint) do update set count = client_errors.count + 1, last_seen = now();
end $$;

create or replace function public.admin_list_errors(p_include_fixed boolean default false)
returns table (id uuid, kind text, path text, message text, stack text, agent text, count int, first_seen timestamptz, last_seen timestamptz, resolved_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_moderator();
  return query
    select e.id, e.kind, e.path, e.message, e.stack, e.agent, e.count, e.first_seen, e.last_seen, e.resolved_at
      from client_errors e
     where p_include_fixed or e.resolved_at is null
     order by e.last_seen desc
     limit 200;
end $$;

create or replace function public.admin_resolve_error(p_id uuid, p_fixed boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_moderator();
  update client_errors set resolved_at = case when p_fixed then now() else null end, resolved_by = case when p_fixed then auth.uid() else null end where id = p_id;
end $$;

revoke all on function public.scrub_error_text(text, int) from public, anon, authenticated;
revoke all on function public.log_client_error(text, text, text, text, text) from public;
revoke all on function public.admin_list_errors(boolean) from public, anon;
revoke all on function public.admin_resolve_error(uuid, boolean) from public, anon;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_list_errors(boolean) to authenticated;
grant execute on function public.admin_resolve_error(uuid, boolean) to authenticated;

-- CHECK (expect: false, true, false, true):
--   select has_table_privilege('anon', 'client_errors', 'select'),
--          has_function_privilege('anon', 'log_client_error(text, text, text, text, text)', 'execute'),
--          has_function_privilege('anon', 'admin_list_errors(boolean)', 'execute'),
--          has_function_privilege('authenticated', 'admin_list_errors(boolean)', 'execute');
