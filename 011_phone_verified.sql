-- 011: phone check. Confirming a report needs a verified phone; so does a second report within 24 hours.
-- Run after 009. Safe to run twice. NOT run against a real database by its author: read the checks at the bottom.
-- Phone numbers stay in Supabase's private auth.users table. Nothing here makes a number visible to anyone.

create or replace function is_phone_verified() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select u.phone_confirmed_at is not null from auth.users u where u.id = auth.uid()), false);
$$;
grant execute on function is_phone_verified() to anon, authenticated;

-- 1. Confirmations (the "I can see this too" button)
create or replace function require_phone_for_confirmation() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then return new; end if;   -- internal or SQL-editor writes
  if not is_phone_verified() and not is_moderator() then
    raise exception 'phone_verification_required' using errcode = 'PV001';
  end if;
  return new;
end $$;
drop trigger if exists confirmations_need_phone on confirmations;
create trigger confirmations_need_phone before insert on confirmations
  for each row execute function require_phone_for_confirmation();

-- 2. Reports: the first one in 24 hours is open to everyone; later ones need a verified phone
create or replace function require_phone_for_repeat_reports() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then return new; end if;
  if not is_phone_verified() and not is_moderator()
     and exists (select 1 from issues i where i.reporter_id = new.reporter_id and i.created_at > now() - interval '24 hours') then
    raise exception 'phone_verification_required' using errcode = 'PV001';
  end if;
  return new;
end $$;
drop trigger if exists issues_need_phone on issues;
create trigger issues_need_phone before insert on issues
  for each row execute function require_phone_for_repeat_reports();

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Both triggers exist:
select tgname from pg_trigger where tgname in ('confirmations_need_phone', 'issues_need_phone') order by tgname;
-- B) The helper works (false is correct here, because the SQL editor is not a signed-in person):
select is_phone_verified();
