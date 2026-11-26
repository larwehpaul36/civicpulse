-- 026: office staff accounts. Run after 025. Safe to run twice.
-- A moderator invites a staff member of an assembly BY EMAIL. The staff member opens /office, asks for an email sign-in link
-- (same as moderators), and then sees only the reports sent to THEIR office, and can reply to them in public.
--   * Nobody can sign up for office access on their own: access exists only for an email a moderator invited.
--   * Access is checked on every call (never cached in the browser), so a moderator can switch someone off instantly.
--   * Only a CONFIRMED email counts, and anonymous resident accounts never do.
--   * Staff see only reports that belong to their office and have already been sent to it (sent, in progress, resolved).
--   * Staff can reply (a message, an expected fix date, "not our job"). They cannot change a status, add a photo,
--     hide anything, or see other offices' reports. Their replies are stored with source 'office'.
--   * Staff emails are personal data: the table is private and only moderators can list it, through functions.

create table if not exists office_staff (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  party_id     uuid not null references responsible_parties(id) on delete cascade,
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid,
  constraint office_staff_email_ok check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
create unique index if not exists office_staff_active_idx on office_staff (email, party_id) where revoked_at is null;
create index if not exists office_staff_party_idx on office_staff (party_id) where revoked_at is null;

alter table office_staff enable row level security;     -- no policies: every read and write goes through the functions below
revoke all on office_staff from anon, authenticated;

-- A reply from a signed-in office is a third kind of source.
alter table office_replies drop constraint if exists office_replies_source_check;
alter table office_replies add constraint office_replies_source_check check (source in ('moderator', 'link', 'office'));

-- The offices the CURRENT user works for. Internal: nobody calls it directly, only the functions below.
create or replace function public.staff_party_ids()
returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select s.party_id
    from public.office_staff s
    join auth.users u on lower(u.email) = s.email
   where u.id = auth.uid()
     and u.email_confirmed_at is not null
     and coalesce(u.is_anonymous, false) = false
     and s.revoked_at is null;
$$;
revoke all on function public.staff_party_ids() from public, anon, authenticated;

-- ---- what office staff call ----

create or replace function public.staff_my_offices()
returns table (party_id uuid, name text)
language plpgsql security definer set search_path = public, auth as $$
begin
  update office_staff s set last_seen_at = now()
   where s.party_id in (select staff_party_ids())
     and (s.last_seen_at is null or s.last_seen_at < now() - interval '1 hour')
     and s.email = (select lower(u.email) from auth.users u where u.id = auth.uid());
  return query
    select p.id, p.name from responsible_parties p where p.id in (select staff_party_ids()) order by p.name;
end $$;

create or replace function public.staff_list_issues()
returns table (
  id uuid, category_id uuid, other_label text, region_id uuid, party_id uuid, party_name text,
  severity text, description text, status text, confirmation_count int,
  created_at timestamptz, sent_at timestamptz, resolved_at timestamptz, days_open int,
  lat double precision, lng double precision, before_path text, after_path text,
  replies_count int, last_reply_at timestamptz, expected_date date)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return query
  select i.id, i.category_id, i.other_label, i.region_id, i.party_id, p.name,
         i.severity::text, i.description, i.status::text, i.confirmation_count,
         i.created_at, i.sent_at, i.resolved_at,
         extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int,
         st_y(i.location::geometry), st_x(i.location::geometry),
         (select ph.storage_path from issue_photos ph where ph.issue_id = i.id and ph.kind = 'before' order by ph.created_at limit 1),
         (select ph.storage_path from issue_photos ph where ph.issue_id = i.id and ph.kind = 'after' order by ph.created_at desc limit 1),
         (select count(*)::int from office_replies r where r.issue_id = i.id and r.removed_at is null),
         (select max(r.created_at) from office_replies r where r.issue_id = i.id and r.removed_at is null),
         (select max(r.expected_date) from office_replies r where r.issue_id = i.id and r.removed_at is null and r.kind = 'expected_date')
    from issues i
    join responsible_parties p on p.id = i.party_id
   where i.party_id in (select staff_party_ids())
     and i.duplicate_of is null
     and i.status::text in ('sent', 'in_progress', 'resolved')
   order by i.sent_at nulls last, i.created_at
   limit 300;
end $$;

create or replace function public.staff_add_reply(
  p_issue uuid, p_kind text, p_body text default null, p_expected date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_party uuid; v_status text; v_id uuid; v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if auth.uid() is null then raise exception 'not_staff' using errcode = '42501'; end if;
  select party_id, status::text into v_party, v_status from issues where id = p_issue and duplicate_of is null;
  -- one answer for "does not exist" and "not yours", so staff cannot probe other offices' reports
  if v_party is null or v_party not in (select staff_party_ids()) then raise exception 'issue_not_found'; end if;
  if v_status not in ('sent', 'in_progress') then raise exception 'not_open'; end if;
  if p_kind is null or p_kind not in ('reply', 'expected_date', 'not_ours') then raise exception 'bad_kind'; end if;
  if p_kind <> 'expected_date' and v_body is null then raise exception 'text_required'; end if;
  if v_body is not null and char_length(v_body) > 500 then raise exception 'too_long'; end if;
  if p_kind = 'expected_date' then
    if p_expected is null then raise exception 'date_required'; end if;
    if p_expected < current_date or p_expected > current_date + 365 then raise exception 'bad_date'; end if;
  else
    p_expected := null;
  end if;
  if (select count(*) from office_replies where issue_id = p_issue and source = 'office' and relayed_by = auth.uid()
        and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into office_replies (issue_id, party_id, kind, body, expected_date, relayed_by, source)
  values (p_issue, v_party, p_kind, v_body, p_expected, auth.uid(), 'office')
  returning id into v_id;
  return v_id;
end $$;

-- ---- what moderators call ----

create or replace function public.admin_invite_office_staff(p_email text, p_party uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  perform assert_moderator();
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'bad_email'; end if;
  if not exists (select 1 from responsible_parties where id = p_party) then raise exception 'party_not_found'; end if;
  select id into v_id from office_staff where email = v_email and party_id = p_party and revoked_at is null;
  if v_id is not null then return v_id; end if;                                       -- already invited: nothing to do
  if (select count(*) from office_staff where party_id = p_party and revoked_at is null) >= 10 then raise exception 'too_many'; end if;
  insert into office_staff (email, party_id, invited_by) values (v_email, p_party, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_list_office_staff()
returns table (id uuid, email text, party_id uuid, party_name text, created_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_moderator();
  return query
    select s.id, s.email, s.party_id, p.name, s.created_at, s.last_seen_at
      from office_staff s join responsible_parties p on p.id = s.party_id
     where s.revoked_at is null
     order by p.name, s.email;
end $$;

create or replace function public.admin_revoke_office_staff(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_moderator();
  update office_staff set revoked_at = now(), revoked_by = auth.uid() where id = p_id and revoked_at is null;
end $$;

revoke all on function public.staff_my_offices() from public, anon;
revoke all on function public.staff_list_issues() from public, anon;
revoke all on function public.staff_add_reply(uuid, text, text, date) from public, anon;
revoke all on function public.admin_invite_office_staff(text, uuid) from public, anon;
revoke all on function public.admin_list_office_staff() from public, anon;
revoke all on function public.admin_revoke_office_staff(uuid) from public, anon;
grant execute on function public.staff_my_offices() to authenticated;
grant execute on function public.staff_list_issues() to authenticated;
grant execute on function public.staff_add_reply(uuid, text, text, date) to authenticated;
grant execute on function public.admin_invite_office_staff(text, uuid) to authenticated;
grant execute on function public.admin_list_office_staff() to authenticated;
grant execute on function public.admin_revoke_office_staff(uuid) to authenticated;

-- CHECK (expect: false, true, false, true):
--   select has_table_privilege('anon', 'office_staff', 'select'),
--          has_function_privilege('authenticated', 'staff_list_issues()', 'execute'),
--          has_function_privilege('anon', 'staff_list_issues()', 'execute'),
--          has_function_privilege('authenticated', 'admin_invite_office_staff(text, uuid)', 'execute');
