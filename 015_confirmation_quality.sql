-- 015: make the "3 neighbours confirm" rule harder to fake, without needing phone numbers. Run after 014. Safe to run twice.
--
-- Every "I can see this too" is still recorded and still thanks the person. But a confirmation only COUNTS
-- toward the public number and toward "verified" when ALL of these are true:
--   1. the account is at least 10 minutes old (or its phone is verified, or it is a moderator),
--   2. the phone reported being within 1 km of the problem when the button was pressed,
--   3. the account has fewer than 20 counting confirmations in the last 24 hours.
-- These rules run in the database, so a script cannot skip them by calling the API directly.
-- Confirmations made before this migration keep counting.
--
-- Privacy: the position sent with a confirmation is used once, inside the trigger, and then thrown away.
-- It is never stored. Nobody, including moderators, can read where a confirmer was.
-- To change the limits, edit the three numbers marked LIMIT below and run this file again.

alter table confirmations add column if not exists lat double precision;
alter table confirmations add column if not exists lng double precision;
alter table confirmations add column if not exists counts boolean not null default true;

-- Great-circle distance in metres between two points.
create or replace function distance_metres(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- The exact spot of a report. For the trigger below ONLY: nobody signed in may call it (exact locations stay private).
create or replace function issue_latlng(p_issue uuid, out lat double precision, out lng double precision)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  select st_y(i.location::geometry), st_x(i.location::geometry) into lat, lng from issues i where i.id = p_issue;
end $$;
revoke all on function issue_latlng(uuid) from public, anon, authenticated;

create or replace function confirmation_quality() returns trigger
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_trusted boolean;
  v_near    boolean := false;
  v_lat     double precision;
  v_lng     double precision;
  v_today   int;
begin
  -- Internal or SQL-editor writes, and moderators: keep as given (counts by default).
  if auth.uid() is null or is_moderator() then
    new.counts := coalesce(new.counts, true);
    new.lat := null; new.lng := null;
    return new;
  end if;

  -- 1. account age, or a verified phone.                                  LIMIT: 10 minutes
  select (now() - u.created_at) >= interval '10 minutes' or u.phone_confirmed_at is not null
    into v_trusted from auth.users u where u.id = new.user_id;

  -- 2. close to the problem when pressing the button.                     LIMIT: 1000 metres
  if new.lat is not null and new.lng is not null
     and new.lat between -90 and 90 and new.lng between -180 and 180 then
    select il.lat, il.lng into v_lat, v_lng from issue_latlng(new.issue_id) il;
    v_near := v_lat is not null and distance_metres(new.lat, new.lng, v_lat, v_lng) <= 1000;
  end if;

  -- 3. not an account that confirms everything in sight.                  LIMIT: 20 per 24 hours
  select count(*) into v_today from confirmations c
   where c.user_id = new.user_id and c.counts and c.created_at > now() - interval '24 hours';

  new.counts := coalesce(v_trusted, false) and v_near and v_today < 20;  -- whatever the app sent is ignored
  new.lat := null;                                                        -- the position is never stored
  new.lng := null;
  return new;
end $$;

drop trigger if exists confirmations_quality on confirmations;
create trigger confirmations_quality before insert on confirmations
  for each row execute function confirmation_quality();

-- Only counting confirmations raise the public number and can verify a report.
create or replace function on_confirmation() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not new.counts then return new; end if;
  update issues
     set confirmation_count = confirmation_count + 1,
         status = case when status = 'reported' and confirmation_count + 1 >= 3
                       then 'verified' else status end
   where id = new.issue_id;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) The trigger exists and is on (tgenabled = O):
select tgname, tgenabled from pg_trigger where tgname = 'confirmations_quality';
-- B) Nobody signed in can read exact locations through the helper (expect: an error or 'f' for both):
select has_function_privilege('anon', 'issue_latlng(uuid)', 'execute') as anon_can,
       has_function_privilege('authenticated', 'issue_latlng(uuid)', 'execute') as signed_in_can;
-- C) Nothing is stored about where confirmers were (expect 0):
select count(*) from confirmations where lat is not null or lng is not null;
