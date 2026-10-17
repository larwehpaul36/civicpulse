-- 008_directory.sql
-- Run after 001-007, in the Supabase SQL editor.
-- A community directory of who is responsible for what, where: anyone can SUGGEST changes,
-- a moderator APPROVES them, and approving applies the change in one step.
--
-- Part 1 closes two gaps in the existing tables:
--   a. responsible_parties could be read in full by anyone, including email, phone, WhatsApp and notes.
--      Now anyone can read only: id, name, type, region_id, verified, created_at.
--      Moderators still see contact details through admin_list_issues and admin_list_suggestions.
--   b. The "suggest party" policy let anyone insert parties directly, and the moderator's party list
--      showed them all. That policy is removed; suggestions go to directory_suggestions instead.

-- ---------------------------------------------------------------- part 1: close the gaps
drop policy if exists "suggest party" on public.responsible_parties;
revoke all on public.responsible_parties from anon, authenticated;
grant select (id, name, type, region_id, verified, created_at) on public.responsible_parties to anon, authenticated;
revoke insert, update, delete, truncate on public.category_responsibilities from anon, authenticated;

-- ---------------------------------------------------------------- part 2: suggestions
create table if not exists public.directory_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_party', 'correction', 'coverage', 'wrong')),
  party_id uuid references public.responsible_parties(id) on delete cascade,  -- not set for new_party
  name text,
  type public.party_type,
  region_id uuid references public.regions(id),
  category_ids uuid[] not null default '{}',
  email text,
  phone text,
  whatsapp text,
  note text,
  suggested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);
create index if not exists directory_suggestions_status_idx on public.directory_suggestions (status, created_at);
create index if not exists directory_suggestions_user_idx on public.directory_suggestions (suggested_by, created_at);
alter table public.directory_suggestions enable row level security;   -- no policies: every read and write goes through the functions
revoke all on public.directory_suggestions from anon, authenticated;

-- kinds: new_party (add a party and what it handles), correction (fix name or contact details),
--        coverage (this party also handles these problems in this area), wrong (this entry is wrong or out of date)
create or replace function public.suggest_directory_change(
  p_kind text,
  p_party uuid default null,
  p_name text default null,
  p_type public.party_type default null,
  p_region uuid default null,
  p_categories uuid[] default '{}',
  p_email text default null,
  p_phone text default null,
  p_whatsapp text default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_whatsapp text := nullif(btrim(coalesce(p_whatsapp, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cats uuid[];
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;

  -- A moderator reads every one of these, so cap how many one account can send.
  if (select count(*) from public.directory_suggestions where suggested_by = v_user and status = 'pending') >= 3 then
    raise exception 'too_many_pending';
  end if;
  if (select count(*) from public.directory_suggestions where suggested_by = v_user and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too_many';
  end if;

  if p_kind is null or p_kind not in ('new_party', 'correction', 'coverage', 'wrong') then raise exception 'bad_kind'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if v_name is not null and length(v_name) not between 2 and 120 then raise exception 'bad_name'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'bad_email'; end if;
  if (v_phone is not null and v_phone !~ '^[0-9+() -]{5,20}$') or (v_whatsapp is not null and v_whatsapp !~ '^[0-9+() -]{5,20}$') then
    raise exception 'bad_phone';
  end if;

  select coalesce(array_agg(distinct c), '{}') into v_cats from unnest(coalesce(p_categories, '{}')) c;
  if cardinality(v_cats) > 20
     or (cardinality(v_cats) > 0 and (select count(*) from public.categories where id = any (v_cats)) <> cardinality(v_cats)) then
    raise exception 'bad_category';
  end if;
  if p_region is not null and not exists (select 1 from public.regions where id = p_region) then raise exception 'bad_region'; end if;
  if p_kind <> 'new_party' and (p_party is null or not exists (select 1 from public.responsible_parties where id = p_party)) then
    raise exception 'bad_party';
  end if;

  if p_kind = 'new_party' then
    if v_name is null then raise exception 'bad_name'; end if;
    if p_type is null then raise exception 'bad_type'; end if;
    if p_region is null then raise exception 'bad_region'; end if;
    if cardinality(v_cats) = 0 then raise exception 'no_categories'; end if;
    if exists (select 1 from public.responsible_parties where lower(name) = lower(v_name) and region_id is not distinct from p_region) then
      raise exception 'already_listed';
    end if;
  elsif p_kind = 'correction' then
    if v_name is null and v_email is null and v_phone is null and v_whatsapp is null then raise exception 'nothing_to_change'; end if;
  elsif p_kind = 'coverage' then
    if p_region is null then raise exception 'bad_region'; end if;
    if cardinality(v_cats) = 0 then raise exception 'no_categories'; end if;
  elsif p_kind = 'wrong' then
    if v_note is null or length(v_note) < 5 then raise exception 'note_required'; end if;
  end if;

  insert into public.directory_suggestions (kind, party_id, name, type, region_id, category_ids, email, phone, whatsapp, note, suggested_by)
  values (p_kind, case when p_kind = 'new_party' then null else p_party end, v_name, p_type, p_region, v_cats, v_email, v_phone, v_whatsapp, v_note, v_user)
  returning id into v_id;
  return v_id;
end;
$$;

-- People can see what became of their own suggestions. No contact details come back.
create or replace function public.my_directory_suggestions()
returns table (id uuid, kind text, party_id uuid, name text, status text, review_note text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.kind, s.party_id, s.name, s.status, s.review_note, s.created_at
  from public.directory_suggestions s
  where s.suggested_by = auth.uid()
  order by s.created_at desc
  limit 20;
$$;

-- Moderators: pending suggestions with the current entry beside them, contact details included.
create or replace function public.admin_list_suggestions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_moderator();
  return coalesce((
    select jsonb_agg(x.item order by x.created_at)
    from (
      select s.created_at,
        jsonb_build_object(
          'id', s.id, 'kind', s.kind, 'party_id', s.party_id, 'name', s.name, 'type', s.type,
          'region_id', s.region_id, 'category_ids', to_jsonb(s.category_ids),
          'email', s.email, 'phone', s.phone, 'whatsapp', s.whatsapp, 'note', s.note, 'created_at', s.created_at,
          'current', case when p.id is null then null else jsonb_build_object(
            'name', p.name, 'type', p.type, 'region_id', p.region_id,
            'email', p.email, 'phone', p.phone, 'whatsapp', p.whatsapp, 'verified', p.verified) end
        ) as item
      from public.directory_suggestions s
      left join public.responsible_parties p on p.id = s.party_id
      where s.status = 'pending'
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Approve applies the change; reject changes nothing. Either way the contact details are wiped from
-- the suggestion afterwards (an approved party keeps them on its own row).
create or replace function public.admin_review_suggestion(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.directory_suggestions%rowtype;
  v_party uuid;
begin
  perform public.assert_moderator();

  select * into s from public.directory_suggestions where id = p_id for update;
  if not found then raise exception 'suggestion_not_found'; end if;
  if s.status <> 'pending' then raise exception 'already_reviewed'; end if;

  if p_approve then
    if s.kind = 'new_party' then
      insert into public.responsible_parties (name, type, region_id, email, phone, whatsapp, verified, created_by)
      values (s.name, s.type, s.region_id, s.email, s.phone, s.whatsapp, true, auth.uid())
      returning id into v_party;
      insert into public.category_responsibilities (category_id, region_id, party_id)
      select c, s.region_id, v_party from unnest(s.category_ids) c
      on conflict do nothing;
    elsif s.kind = 'correction' then
      update public.responsible_parties
      set name = coalesce(s.name, name), email = coalesce(s.email, email),
          phone = coalesce(s.phone, phone), whatsapp = coalesce(s.whatsapp, whatsapp)
      where id = s.party_id;
    elsif s.kind = 'coverage' then
      insert into public.category_responsibilities (category_id, region_id, party_id)
      select c, s.region_id, s.party_id from unnest(s.category_ids) c
      on conflict do nothing;
    elsif s.kind = 'wrong' then
      -- Out of the public directory, out of the assign list, and no more automatic matches.
      update public.responsible_parties set verified = false where id = s.party_id;
      delete from public.category_responsibilities where party_id = s.party_id;
    end if;
  end if;

  update public.directory_suggestions
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      email = null, phone = null, whatsapp = null
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- who may call what
revoke all on function public.suggest_directory_change(text, uuid, text, public.party_type, uuid, uuid[], text, text, text, text) from public, anon;
revoke all on function public.my_directory_suggestions() from public, anon;
revoke all on function public.admin_list_suggestions() from public, anon;
revoke all on function public.admin_review_suggestion(uuid, boolean, text) from public, anon;
grant execute on function public.suggest_directory_change(text, uuid, text, public.party_type, uuid, uuid[], text, text, text, text) to authenticated;
grant execute on function public.my_directory_suggestions() to authenticated;
grant execute on function public.admin_list_suggestions() to authenticated;
grant execute on function public.admin_review_suggestion(uuid, boolean, text) to authenticated;
