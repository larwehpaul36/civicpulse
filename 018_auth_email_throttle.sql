-- 018: spending limits for sign-in emails, with room always kept for moderators. Run after 017. Safe to run twice.
-- Needed ONLY if you switch on the optional Send Email hook (supabase/functions/auth-email/README.md). Running it alone changes nothing.
--
-- Without it, one person could ask for link emails again and again and use up the project's hourly email allowance, which
-- would also stop moderators' sign-in links. With the hook, every auth email asks this function first:
--   * moderators are ALWAYS allowed and never count toward the resident limits;
--   * a resident account may get 4 emails per 24 hours;
--   * one email address may get 3 emails per 24 hours, from any accounts (so we cannot be used to pester a stranger);
--   * all residents together may get 30 emails per hour and 300 per day, which leaves moderators headroom.
-- Change the numbers marked LIMIT below and run this file again.
-- Privacy: addresses are never stored here, only a one-way fingerprint, and rows are deleted after 3 days.

create table if not exists auth_email_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  to_hash    text not null,
  email_type text not null,
  resident   boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_email_log_user_idx on auth_email_log (user_id, created_at);
create index if not exists auth_email_log_to_idx   on auth_email_log (to_hash, created_at);
create index if not exists auth_email_log_time_idx on auth_email_log (created_at);
alter table auth_email_log enable row level security;   -- no policies: only the function below can touch it
revoke all on auth_email_log from anon, authenticated;

create or replace function allow_auth_email(p_user uuid, p_to text, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(p_user, '00000000-0000-0000-0000-000000000000');
  v_hash text := encode(sha256(convert_to(lower(btrim(coalesce(p_to, ''))), 'UTF8')), 'hex');
  v_mod  boolean := exists (select 1 from moderators m where m.user_id = p_user);
begin
  perform pg_advisory_xact_lock(7340018);                      -- one at a time, so two requests cannot both slip under a limit
  delete from auth_email_log where created_at < now() - interval '3 days';

  if not v_mod then
    if (select count(*) from auth_email_log where user_id = v_user and created_at > now() - interval '24 hours') >= 4 then      -- LIMIT: per account per day
      return jsonb_build_object('allowed', false, 'reason', 'user');
    end if;
    if (select count(*) from auth_email_log where to_hash = v_hash and created_at > now() - interval '24 hours') >= 3 then      -- LIMIT: per address per day
      return jsonb_build_object('allowed', false, 'reason', 'address');
    end if;
    if (select count(*) from auth_email_log where resident and created_at > now() - interval '1 hour') >= 30                    -- LIMIT: all residents, per hour
       or (select count(*) from auth_email_log where resident and created_at > now() - interval '24 hours') >= 300 then          -- LIMIT: all residents, per day
      return jsonb_build_object('allowed', false, 'reason', 'busy');
    end if;
  end if;

  insert into auth_email_log (user_id, to_hash, email_type, resident) values (v_user, v_hash, coalesce(p_type, ''), not v_mod);
  return jsonb_build_object('allowed', true, 'reason', case when v_mod then 'moderator' else 'ok' end);
end $$;

revoke all on function allow_auth_email(uuid, text, text) from public, anon, authenticated;
grant execute on function allow_auth_email(uuid, text, text) to service_role;   -- the email hook only

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Only the hook (service role) may call it (expect: anon f, signed_in f, service t):
select has_function_privilege('anon', 'allow_auth_email(uuid,text,text)', 'execute') as anon_can,
       has_function_privilege('authenticated', 'allow_auth_email(uuid,text,text)', 'execute') as signed_in_can,
       has_function_privilege('service_role', 'allow_auth_email(uuid,text,text)', 'execute') as service_can;
-- B) The log never holds an email address (expect 0):
select count(*) from auth_email_log where to_hash like '%@%';
