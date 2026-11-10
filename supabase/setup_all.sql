-- CivicPulse: all migrations 001-020 in order. Paste into the Supabase SQL editor on a FRESH project.
-- Generated from the numbered files; edit those, not this. Rebuild: node scripts/build-setup-sql.mjs > supabase/setup_all.sql

-- ===================== 001_civicpulse_schema.sql =====================
-- CivicPulse core schema (Supabase / Postgres + PostGIS)
-- Run in the Supabase SQL editor, or save as supabase/migrations/001_civicpulse_schema.sql

create extension if not exists postgis;

-- ---------- Enums ----------
create type issue_status as enum ('reported','verified','sent','in_progress','resolved','rejected');
create type issue_severity as enum ('low','medium','high','hazard');
create type party_type as enum ('government','contractor','utility','private','community');
create type region_level as enum ('country','region','city','area');

-- ---------- Regions (country > region > city > area) ----------
create table regions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references regions(id),
  level region_level not null,
  name text not null,
  country_code char(2),            -- e.g. GH, NG
  created_at timestamptz default now()
);
create index on regions(parent_id);

-- ---------- Categories (two levels; names are per-language JSON) ----------
create table category_groups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name jsonb not null,             -- {"en":"Sanitation","fr":"Assainissement"}
  sort int default 0
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references category_groups(id),
  slug text unique not null,
  name jsonb not null,
  enabled boolean default false,   -- launch with 3-4 enabled, add more as people ask
  sort int default 0
);

-- ---------- Responsible parties and who handles what, where ----------
create table responsible_parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type party_type not null,
  region_id uuid references regions(id),   -- area covered
  email text,
  phone text,
  whatsapp text,
  notes text,
  verified boolean default false,          -- community-added until confirmed
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- The engine of the app: for this category in this region, who is responsible?
create table category_responsibilities (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  region_id uuid not null references regions(id),
  party_id uuid not null references responsible_parties(id),
  unique (category_id, region_id, party_id)
);

-- ---------- Users ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- ---------- Issues ----------
create table issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id),
  category_id uuid not null references categories(id),
  region_id uuid references regions(id),
  party_id uuid references responsible_parties(id),
  severity issue_severity not null default 'medium',
  description text,
  details jsonb default '{}'::jsonb,       -- category-specific extras
  location geography(Point,4326) not null, -- exact, private
  public_location geography(Point,4326),   -- rounded, safe to show publicly
  is_sensitive boolean default false,
  status issue_status not null default 'reported',
  duplicate_of uuid references issues(id),
  confirmation_count int not null default 0,
  created_at timestamptz default now(),
  sent_at timestamptz,
  resolved_at timestamptz
);
create index on issues using gist (location);
create index on issues(status);
create index on issues(category_id, region_id);

create table issue_photos (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  kind text not null check (kind in ('before','after')),
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table confirmations (             -- "I can see this too"
  issue_id uuid references issues(id) on delete cascade,
  user_id uuid references auth.users(id),
  created_at timestamptz default now(),
  primary key (issue_id, user_id)
);

create table flags (                     -- spam / false report
  issue_id uuid references issues(id) on delete cascade,
  user_id uuid references auth.users(id),
  reason text,
  created_at timestamptz default now(),
  primary key (issue_id, user_id)
);

create table issue_links (               -- waste -> choked gutter -> flooding
  issue_a uuid references issues(id) on delete cascade,
  issue_b uuid references issues(id) on delete cascade,
  relation text default 'related',
  primary key (issue_a, issue_b),
  check (issue_a <> issue_b)
);

-- Append-only history: the evidence trail behind the public tracker
create table status_log (
  id bigint generated always as identity primary key,
  issue_id uuid not null references issues(id) on delete cascade,
  from_status issue_status,
  to_status issue_status not null,
  note text,
  actor uuid,
  created_at timestamptz default now()
);

-- Every attempt to reach a responsible party, so "no response in 14 days" is data
create table contact_attempts (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  party_id uuid references responsible_parties(id),
  channel text,                          -- email, whatsapp, phone, in_person
  note text,
  response_received boolean default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ---------- Triggers ----------
-- Verify after 3 independent confirmations
create function on_confirmation() returns trigger language plpgsql as $$
begin
  update issues
     set confirmation_count = confirmation_count + 1,
         status = case when status = 'reported' and confirmation_count + 1 >= 3
                       then 'verified' else status end
   where id = new.issue_id;
  return new;
end $$;
create trigger trg_confirmation after insert on confirmations
  for each row execute function on_confirmation();

-- Log every status change and stamp sent/resolved times
create function on_status_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into status_log(issue_id, to_status, actor) values (new.id, new.status, new.reporter_id);
  elsif new.status is distinct from old.status then
    insert into status_log(issue_id, from_status, to_status, actor)
      values (new.id, old.status, new.status, auth.uid());
    if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
    if new.status = 'resolved' then new.resolved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger trg_status_before before update on issues
  for each row execute function on_status_change();
create trigger trg_status_after after insert on issues
  for each row execute function on_status_change();

-- Auto-fill the responsible party and a rounded public location on insert
create function on_issue_insert() returns trigger language plpgsql as $$
begin
  if new.party_id is null then
    select party_id into new.party_id
      from category_responsibilities
     where category_id = new.category_id and region_id = new.region_id
     limit 1;
  end if;
  new.public_location := st_snaptogrid(new.location::geometry, 0.001)::geography; -- ~100 m
  return new;
end $$;
create trigger trg_issue_insert before insert on issues
  for each row execute function on_issue_insert();

-- ---------- Functions and views ----------
-- Duplicate check: same category within a radius (default 50 m), still open
create function find_nearby_duplicates(lat double precision, lng double precision,
                                       cat uuid, radius_m int default 50)
returns setof issues language sql stable as $$
  select * from issues
   where category_id = cat
     and status not in ('resolved','rejected')
     and st_dwithin(location, st_makepoint(lng, lat)::geography, radius_m)
   order by created_at;
$$;

-- Safe public feed: never exposes exact location of sensitive reports
create view public_issues as
select i.id, i.category_id, i.region_id, i.party_id, i.severity, i.description,
       i.status, i.confirmation_count, i.created_at, i.sent_at, i.resolved_at,
       case when i.is_sensitive then st_snaptogrid(i.public_location::geometry, 0.01)::geography
            else i.public_location end as location,
       extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int as days_open
  from issues i
 where i.status <> 'rejected' and i.duplicate_of is null;

-- The tracker's core: how fast does each party resolve each category?
create view party_performance as
select p.id as party_id, p.name, c.id as category_id,
       count(*) filter (where i.status = 'resolved') as resolved,
       count(*) filter (where i.status in ('sent','in_progress')) as open_cases,
       round(avg(extract(epoch from i.resolved_at - i.sent_at)/86400)
             filter (where i.status = 'resolved')::numeric, 1) as avg_days_to_resolve
  from issues i
  join responsible_parties p on p.id = i.party_id
  join categories c on c.id = i.category_id
 where i.sent_at is not null
 group by p.id, p.name, c.id;

-- ---------- Row Level Security ----------
alter table issues enable row level security;
alter table confirmations enable row level security;
alter table flags enable row level security;
alter table issue_photos enable row level security;
alter table contact_attempts enable row level security;
alter table responsible_parties enable row level security;
alter table profiles enable row level security;

-- Reads
create policy "issues readable" on issues for select using (status <> 'rejected');
create policy "photos readable" on issue_photos for select using (true);
create policy "parties readable" on responsible_parties for select using (true);
create policy "contacts readable" on contact_attempts for select using (true);
create policy "own profile" on profiles for select using (auth.uid() = id);

-- Writes (signed-in users, including Supabase anonymous sign-ins)
create policy "report issues" on issues for insert with check (auth.uid() = reporter_id);
create policy "edit own issue" on issues for update using (auth.uid() = reporter_id);
create policy "confirm once" on confirmations for insert with check (auth.uid() = user_id);
create policy "flag once" on flags for insert with check (auth.uid() = user_id);
create policy "add photos" on issue_photos for insert with check (auth.uid() = uploaded_by);
create policy "log contact" on contact_attempts for insert with check (auth.uid() = created_by);
create policy "suggest party" on responsible_parties for insert
  with check (auth.uid() = created_by and verified = false);

-- ---------- Seed data: launch in Ghana, 4 categories enabled ----------
insert into regions (level, name, country_code) values ('country','Ghana','GH');
insert into regions (parent_id, level, name)
  select id, 'region', 'Greater Accra' from regions where name = 'Ghana';
insert into regions (parent_id, level, name)
  select id, 'city', 'Accra' from regions where name = 'Greater Accra';

insert into category_groups (slug, name, sort) values
  ('sanitation',  '{"en":"Sanitation"}', 1),
  ('drainage',    '{"en":"Drainage and flooding"}', 2),
  ('roads',       '{"en":"Roads"}', 3),
  ('lighting',    '{"en":"Lighting and power"}', 4),
  ('water',       '{"en":"Water"}', 5),
  ('safety',      '{"en":"Safety"}', 6),
  ('public',      '{"en":"Public spaces"}', 7);

insert into categories (group_id, slug, name, enabled)
select g.id, v.slug, v.name::jsonb, v.enabled
  from (values
    ('sanitation','overflowing-bin','{"en":"Overflowing bin"}', true),
    ('sanitation','illegal-dumping','{"en":"Illegal dumping"}', false),
    ('drainage','choked-gutter','{"en":"Choked gutter"}', true),
    ('roads','pothole','{"en":"Pothole"}', true),
    ('lighting','broken-streetlight','{"en":"Broken streetlight"}', true),
    ('water','burst-pipe','{"en":"Burst pipe"}', false),
    ('safety','open-manhole','{"en":"Open manhole"}', false)
  ) as v(grp, slug, name, enabled)
  join category_groups g on g.slug = v.grp;

-- ===================== 002_ghana_regions.sql =====================
-- Seed all 16 regions of Ghana under the existing country row.
-- Safe to run after 001: it skips Greater Accra if it already exists.

create unique index if not exists regions_parent_name_uniq on regions(parent_id, name);

insert into regions (parent_id, level, name)
select g.id, 'region', r.name
  from regions g
  cross join (values
    ('Ahafo'),
    ('Ashanti'),
    ('Bono'),
    ('Bono East'),
    ('Central'),
    ('Eastern'),
    ('Greater Accra'),
    ('North East'),
    ('Northern'),
    ('Oti'),
    ('Savannah'),
    ('Upper East'),
    ('Upper West'),
    ('Volta'),
    ('Western'),
    ('Western North')
  ) as r(name)
 where g.name = 'Ghana' and g.level = 'country'
on conflict (parent_id, name) do nothing;

-- Optional: major cities, one per region capital. Add more as users request them.
insert into regions (parent_id, level, name)
select reg.id, 'city', c.city
  from regions reg
  join (values
    ('Ashanti','Kumasi'),
    ('Northern','Tamale'),
    ('Central','Cape Coast'),
    ('Western','Sekondi-Takoradi'),
    ('Volta','Ho'),
    ('Eastern','Koforidua'),
    ('Bono','Sunyani'),
    ('Upper East','Bolgatanga'),
    ('Upper West','Wa')
  ) as c(region, city) on c.region = reg.name
 where reg.level = 'region'
on conflict (parent_id, name) do nothing;

-- ===================== 003_security_and_storage.sql =====================
-- 003: security fixes for 001, plus photo storage. Run after 001 and 002.

-- 1. Tables that had no row-level security (anyone could write to them via the API)
alter table regions                  enable row level security;
alter table category_groups          enable row level security;
alter table categories               enable row level security;
alter table category_responsibilities enable row level security;
alter table status_log               enable row level security;
alter table issue_links              enable row level security;

create policy "read" on regions                   for select using (true);
create policy "read" on category_groups           for select using (true);
create policy "read" on categories                for select using (true);
create policy "read" on category_responsibilities for select using (true);
create policy "read" on status_log                for select using (true);
create policy "read" on issue_links               for select using (true);
-- No write policies: admins change these from the Supabase dashboard for now.

-- 2. Issues: hide exact location, and stop users setting their own status
revoke all on issues from anon, authenticated;
grant select (id, reporter_id, category_id, region_id, party_id, severity, description,
              details, is_sensitive, status, duplicate_of, confirmation_count,
              created_at, sent_at, resolved_at)
  on issues to anon, authenticated;
grant insert (id, reporter_id, category_id, region_id, severity, description,
              details, location, is_sensitive)
  on issues to authenticated;
drop policy if exists "edit own issue" on issues;
grant select on public_issues, party_performance to anon, authenticated;

-- 3. Confirmations: readable by their owner, and you can't confirm your own report
create policy "see own confirmations" on confirmations for select using (auth.uid() = user_id);
drop policy if exists "confirm once" on confirmations;
create policy "confirm others only" on confirmations for insert with check (
  auth.uid() = user_id
  and not exists (select 1 from issues where id = issue_id and reporter_id = auth.uid())
);

-- 4. Triggers must run with owner rights, because users can no longer update issues
alter function on_confirmation()  security definer set search_path = public, extensions;
alter function on_status_change() security definer set search_path = public, extensions;
alter function on_issue_insert()  security definer set search_path = public, extensions;

-- 5. Duplicate check must not leak other people's exact locations
drop function if exists find_nearby_duplicates(double precision, double precision, uuid, int);
create function find_nearby_duplicates(lat double precision, lng double precision,
                                       cat uuid, radius_m int default 50)
returns table (id uuid, description text, status issue_status,
               confirmation_count int, days_open int)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.description, i.status, i.confirmation_count,
         extract(day from now() - i.created_at)::int
    from issues i
   where i.category_id = cat
     and i.status not in ('resolved','rejected')
     and st_dwithin(i.location, st_makepoint(lng, lat)::geography, radius_m)
   order by i.created_at;
$$;
grant execute on function find_nearby_duplicates to anon, authenticated;

-- 6. Photo storage: small JPEGs only, each user writes only into their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos'
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ===================== 004_region_matching_and_public_view.sql =====================
-- 004: run after 001-003.

-- 1. Responsible-party matching now walks up the region tree:
--    an issue filed under "Accra" finds a party mapped to Accra, then Greater Accra, then Ghana.
create or replace function on_issue_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.party_id is null and new.region_id is not null then
    with recursive up as (
      select id, parent_id, 0 as depth from regions where id = new.region_id
      union all
      select r.id, r.parent_id, up.depth + 1 from regions r join up on r.id = up.parent_id
    )
    select cr.party_id into new.party_id
      from up
      join category_responsibilities cr
        on cr.region_id = up.id and cr.category_id = new.category_id
     order by up.depth
     limit 1;
  end if;
  new.public_location := st_snaptogrid(new.location::geometry, 0.001)::geography; -- ~100 m
  return new;
end $$;

-- 2. Public feed with plain lat/lng numbers for the map (still rounded, never exact)
drop view if exists public_issues;
create view public_issues as
select i.id, i.category_id, i.region_id, i.party_id, i.severity, i.description,
       i.status, i.confirmation_count, i.created_at, i.sent_at, i.resolved_at,
       extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int as days_open,
       st_y(p.pt) as lat, st_x(p.pt) as lng
  from issues i
 cross join lateral (
   select case when i.is_sensitive
               then st_snaptogrid(i.public_location::geometry, 0.01)   -- ~1 km
               else i.public_location::geometry end as pt
 ) p
 where i.status <> 'rejected' and i.duplicate_of is null;
grant select on public_issues to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dev helpers (commented out). Run from the Supabase SQL editor, which acts as admin.
-- Moderator screens come later; until then use these to test the tracker.
--
-- -- Add a responsible party for choked gutters in Accra:
-- insert into responsible_parties (name, type, region_id, verified)
--   select 'Accra Metropolitan Assembly', 'government', id, true
--   from regions where name = 'Accra' and level = 'city';
-- insert into category_responsibilities (category_id, region_id, party_id)
--   select c.id, r.id, p.id from categories c, regions r, responsible_parties p
--   where c.slug = 'choked-gutter' and r.name = 'Accra' and p.name = 'Accra Metropolitan Assembly';
--
-- -- Move a case through the pipeline (replace the id):
-- update issues set status = 'sent'     where id = 'ISSUE-UUID';
-- update issues set status = 'resolved' where id = 'ISSUE-UUID';
--
-- -- Log an attempt to contact the party:
-- insert into contact_attempts (issue_id, party_id, channel, note)
--   select id, party_id, 'whatsapp', 'Sent case summary' from issues where id = 'ISSUE-UUID';

-- ===================== 005_moderators.sql =====================
-- 005: moderator role and admin functions. Run after 001-004.
-- All admin actions go through functions that check is_moderator(), because
-- anonymous reporters and moderators share the same database role.

create table moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table moderators enable row level security;
revoke all on moderators from anon, authenticated;

create function is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from moderators where user_id = auth.uid());
$$;

create function assert_moderator() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
end $$;

-- Everything a moderator needs in one call, including the exact location
create function admin_list_issues() returns table (
  id uuid, category_id uuid, region_id uuid, party_id uuid,
  party_name text, party_email text, party_phone text, party_whatsapp text,
  severity issue_severity, description text, status issue_status,
  confirmation_count int, flag_count int,
  created_at timestamptz, sent_at timestamptz, resolved_at timestamptz,
  days_open int, lat double precision, lng double precision,
  before_path text, after_path text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  return query
  select i.id, i.category_id, i.region_id, i.party_id,
         p.name, p.email, p.phone, p.whatsapp,
         i.severity, i.description, i.status, i.confirmation_count,
         (select count(*)::int from flags f where f.issue_id = i.id),
         i.created_at, i.sent_at, i.resolved_at,
         extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int,
         st_y(i.location::geometry), st_x(i.location::geometry),
         (select ph.storage_path from issue_photos ph
           where ph.issue_id = i.id and ph.kind = 'before' order by ph.created_at limit 1),
         (select ph.storage_path from issue_photos ph
           where ph.issue_id = i.id and ph.kind = 'after' order by ph.created_at desc limit 1)
    from issues i
    left join responsible_parties p on p.id = i.party_id
   where i.duplicate_of is null
   order by i.created_at desc
   limit 300;
end $$;

-- Status changes. Evidence rules: "sent" needs a party, "resolved" needs an after photo.
create function admin_set_status(p_issue uuid, p_status issue_status, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_old issue_status; v_party uuid;
begin
  perform assert_moderator();
  select status, party_id into v_old, v_party from issues where id = p_issue;
  if not found then raise exception 'not_found'; end if;
  if v_old = p_status then return; end if;
  if p_status = 'sent' and v_party is null then
    raise exception 'party_required';
  end if;
  if p_status = 'resolved' and not exists
     (select 1 from issue_photos where issue_id = p_issue and kind = 'after') then
    raise exception 'after_photo_required';
  end if;
  update issues
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then resolved_at else null end
   where id = p_issue;
  if p_note is not null then
    update status_log set note = p_note
     where id = (select max(l.id) from status_log l where l.issue_id = p_issue);
  end if;
end $$;

-- Assign a party; optionally remember it for this category and region for future reports
create function admin_assign_party(p_issue uuid, p_party uuid, p_remember boolean default true)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  update issues set party_id = p_party where id = p_issue;
  if p_remember then
    insert into category_responsibilities (category_id, region_id, party_id)
    select category_id, region_id, p_party from issues
     where id = p_issue and region_id is not null
    on conflict do nothing;
  end if;
end $$;

create function admin_log_contact(p_issue uuid, p_channel text, p_note text, p_response boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  insert into contact_attempts (issue_id, party_id, channel, note, response_received, created_by)
  select id, party_id, p_channel, p_note, p_response, auth.uid() from issues where id = p_issue;
end $$;

create function admin_add_after_photo(p_issue uuid, p_path text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  insert into issue_photos (issue_id, kind, storage_path, uploaded_by)
  values (p_issue, 'after', p_path, auth.uid());
end $$;

create function admin_dismiss_flags(p_issue uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  delete from flags where issue_id = p_issue;
end $$;

create function admin_add_party(p_name text, p_type party_type, p_region uuid,
                                p_email text, p_phone text, p_whatsapp text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform assert_moderator();
  insert into responsible_parties (name, type, region_id, email, phone, whatsapp, verified, created_by)
  values (p_name, p_type, p_region, nullif(p_email, ''), nullif(p_phone, ''),
          nullif(p_whatsapp, ''), true, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Moderators may upload "after" photos (into the after/ folder only)
create policy "moderators upload after photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-photos'
              and (storage.foldername(name))[1] = 'after'
              and is_moderator());

-- Only signed-in users can call these (each one also re-checks is_moderator)
do $$
declare f record;
begin
  for f in
    select oid::regprocedure as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and (proname like 'admin\_%' or proname in ('is_moderator', 'assert_moderator'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Make yourself a moderator. First open /admin and sign in once with your email
-- (so your account exists), then run this with your real email:
--
-- insert into moderators (user_id) select id from auth.users where email = 'you@example.com';

-- ===================== 006_issue_links.sql =====================
-- 006_issue_links.sql
-- Run after 001-005, in the Supabase SQL editor.
-- Lets moderators link reports about the same problem, or about a related one.
-- The issue_links table already exists (001) and anyone can read it.
-- Nobody can write to it directly; the two functions below are the only way, and they check assert_moderator().

create or replace function public.admin_link_issues(
  p_a uuid,
  p_b uuid,
  p_relation text default 'related'   -- 'related' or 'duplicate' (the same problem reported twice)
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first uuid;
  v_second uuid;
begin
  perform public.assert_moderator();

  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'same_issue';
  end if;
  if p_relation is null or p_relation not in ('related', 'duplicate') then
    raise exception 'bad_relation';
  end if;
  if (select count(*) from public.issues where id in (p_a, p_b)) <> 2 then
    raise exception 'issue_not_found';
  end if;

  -- One row per pair: the smaller id goes first, so (a, b) and (b, a) can never both exist.
  v_first := least(p_a, p_b);
  v_second := greatest(p_a, p_b);

  delete from public.issue_links where issue_a = v_second and issue_b = v_first;

  insert into public.issue_links (issue_a, issue_b, relation)
  values (v_first, v_second, p_relation)
  on conflict (issue_a, issue_b) do update set relation = excluded.relation;
end;
$$;

create or replace function public.admin_unlink_issues(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_moderator();

  delete from public.issue_links
  where (issue_a = p_a and issue_b = p_b)
     or (issue_a = p_b and issue_b = p_a);
end;
$$;

revoke all on function public.admin_link_issues(uuid, uuid, text) from public, anon;
revoke all on function public.admin_unlink_issues(uuid, uuid) from public, anon;
grant execute on function public.admin_link_issues(uuid, uuid, text) to authenticated;
grant execute on function public.admin_unlink_issues(uuid, uuid) to authenticated;

-- ===================== 007_notifications.sql =====================
-- 007_notifications.sql
-- Run after 001-006, in the Supabase SQL editor.
-- Tells reporters (and the neighbours who confirmed a report) when its status changes.
--   1. In-app: every status change adds a row to `notifications`; people read their own rows.
--   2. Web push: browsers register in `push_subscriptions`; an Edge Function sends the push.
--   3. Email (optional, off in the app until NEXT_PUBLIC_EMAIL_NOTICES=1): `notification_contacts`
--      holds a verified address, with a one-click unsubscribe.
-- Sending (push and email) is done by the `notify` Edge Function, fed by a Database Webhook.
-- Nothing here can be written from the app directly; every write goes through the functions below.

-- ---------------------------------------------------------------- in-app feed
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id uuid not null references public.issues(id) on delete cascade,
  to_status text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- On every status change: one notification for the reporter and one for each person who confirmed.
-- A problem here must never block the status change itself, so errors are logged, not raised.
create or replace function public.notify_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.to_status::text = 'reported' then
    return new;
  end if;
  begin
    insert into public.notifications (user_id, issue_id, to_status)
    select distinct f.user_id, new.issue_id, new.to_status::text
    from (
      select reporter_id as user_id from public.issues where id = new.issue_id
      union
      select user_id from public.confirmations where issue_id = new.issue_id
    ) f
    where f.user_id is not null;
  exception when others then
    raise warning 'notify_status_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_status_change on public.status_log;
create trigger notify_status_change after insert on public.status_log
  for each row execute function public.notify_status_change();

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- The reports this browser's anonymous account made, in the same shape as the public list.
create or replace function public.my_reports()
returns setof public.public_issues
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.public_issues p
  where p.id in (select i.id from public.issues i where i.reporter_id = auth.uid());
$$;

-- ---------------------------------------------------------------- web push
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;   -- no policies: only the service role reads this
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'bad_endpoint';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, clock_timestamp())
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, created_at = clock_timestamp();

  -- keep the five newest per account
  delete from public.push_subscriptions
  where user_id = auth.uid()
    and endpoint not in (
      select endpoint from public.push_subscriptions where user_id = auth.uid() order by created_at desc, endpoint limit 5
    );
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- optional email
-- One address per anonymous account. Nothing is sent until the owner clicks the link in a
-- verification email, so nobody can sign up somebody else's address.
create table if not exists public.notification_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  consent_at timestamptz not null default now(),
  verify_token uuid not null default gen_random_uuid(),
  verified_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);
alter table public.notification_contacts enable row level security;   -- no policies: service role only
revoke all on public.notification_contacts from anon, authenticated;

create or replace function public.set_notification_contact(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_updated timestamptz;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'bad_email';
  end if;

  select updated_at into v_updated from public.notification_contacts where user_id = auth.uid();
  if v_updated is not null and v_updated > now() - interval '10 minutes' then
    raise exception 'too_soon';   -- limits how many verification emails one account can trigger
  end if;

  insert into public.notification_contacts (user_id, email, consent_at, verify_token, verified_at, updated_at)
  values (auth.uid(), v_email, now(), gen_random_uuid(), null, now())
  on conflict (user_id) do update
    set email = excluded.email, consent_at = now(), verify_token = gen_random_uuid(),
        verified_at = null, updated_at = now();
end;
$$;

-- Never returns the tokens: those only go out by email.
create or replace function public.my_notification_contact()
returns table (email text, verified boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.email, c.verified_at is not null from public.notification_contacts c where c.user_id = auth.uid();
$$;

create or replace function public.clear_notification_contact()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notification_contacts where user_id = auth.uid();
$$;

-- The two links in the emails open in whatever browser the person uses, so they work from the token alone.
create or replace function public.confirm_notification_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_contacts set verified_at = coalesce(verified_at, now()) where verify_token = p_token;
  return found;
end;
$$;

create or replace function public.unsubscribe_contact(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notification_contacts where unsubscribe_token = p_token;
  return found;
end;
$$;

-- ---------------------------------------------------------------- who may call what
revoke all on function public.mark_notifications_read() from public, anon;
revoke all on function public.my_reports() from public, anon;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.set_notification_contact(text) from public, anon;
revoke all on function public.my_notification_contact() from public, anon;
revoke all on function public.clear_notification_contact() from public, anon;
revoke all on function public.confirm_notification_email(uuid) from public;
revoke all on function public.unsubscribe_contact(uuid) from public;

grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.my_reports() to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.set_notification_contact(text) to authenticated;
grant execute on function public.my_notification_contact() to authenticated;
grant execute on function public.clear_notification_contact() to authenticated;
grant execute on function public.confirm_notification_email(uuid) to anon, authenticated;
grant execute on function public.unsubscribe_contact(uuid) to anon, authenticated;

-- ===================== 008_directory.sql =====================
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

-- ===================== 009_other_category.sql =====================
-- 009: "Other problem" reports (something that is not on the list). Run after 001-008. Safe to run twice.
-- NOT run against a real database by its author: read the checks at the bottom and send me any error.

-- 1. The category people pick when their problem is not on the list. It sorts last.
insert into category_groups (slug, name, sort)
select 'other', '{"en":"Not on the list"}'::jsonb, 99
 where not exists (select 1 from category_groups where slug = 'other');

insert into categories (group_id, slug, name, enabled, sort)
select g.id, 'other', '{"en":"Other problem"}'::jsonb, true, 999
  from category_groups g
 where g.slug = 'other'
   and not exists (select 1 from categories where slug = 'other');

-- 2. The person's own words live in issues.details (they can already write that column).
--    Keep it small, only allow the label on "Other" reports, and require it there.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'issues_details_small') then
    alter table issues add constraint issues_details_small check (octet_length(details::text) <= 500);
  end if;
end $$;

create or replace function enforce_other_label() returns trigger
language plpgsql set search_path = public as $$
declare is_other boolean;
begin
  select (c.slug = 'other') into is_other from categories c where c.id = new.category_id;
  new.details := coalesce(new.details, '{}'::jsonb);
  if coalesce(is_other, false) then
    new.details := jsonb_build_object('other_label', left(btrim(coalesce(new.details->>'other_label', '')), 80));
    if new.details->>'other_label' = '' then
      raise exception 'other_label_required' using errcode = '22023';
    end if;
  else
    new.details := new.details - 'other_label';   -- nobody can attach a public label to a normal category
  end if;
  return new;
end $$;

drop trigger if exists issues_other_label on issues;
create trigger issues_other_label before insert on issues
  for each row execute function enforce_other_label();

-- 3. The public view gains one column at the END (existing columns unchanged).
create or replace view public_issues as
select i.id, i.category_id, i.region_id, i.party_id, i.severity, i.description,
       i.status, i.confirmation_count, i.created_at, i.sent_at, i.resolved_at,
       extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int as days_open,
       st_y(p.pt) as lat, st_x(p.pt) as lng,
       nullif(left(i.details->>'other_label', 80), '') as other_label
  from issues i
 cross join lateral (
   select case when i.is_sensitive
               then st_snaptogrid(i.public_location::geometry, 0.01)   -- ~1 km
               else i.public_location::geometry end as pt
 ) p
 where i.status <> 'rejected' and i.duplicate_of is null;

-- 4. Moderator list gains other_label (a function's output cannot be changed in place, so drop and recreate).
drop function if exists admin_list_issues();
create function admin_list_issues() returns table (
  id uuid, category_id uuid, region_id uuid, party_id uuid,
  party_name text, party_email text, party_phone text, party_whatsapp text,
  severity issue_severity, description text, status issue_status,
  confirmation_count int, flag_count int,
  created_at timestamptz, sent_at timestamptz, resolved_at timestamptz,
  days_open int, lat double precision, lng double precision,
  before_path text, after_path text, other_label text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  return query
  select i.id, i.category_id, i.region_id, i.party_id,
         p.name, p.email, p.phone, p.whatsapp,
         i.severity, i.description, i.status, i.confirmation_count,
         (select count(*)::int from flags f where f.issue_id = i.id),
         i.created_at, i.sent_at, i.resolved_at,
         extract(day from coalesce(i.resolved_at, now()) - i.created_at)::int,
         st_y(i.location::geometry), st_x(i.location::geometry),
         (select ph.storage_path from issue_photos ph
           where ph.issue_id = i.id and ph.kind = 'before' order by ph.created_at limit 1),
         (select ph.storage_path from issue_photos ph
           where ph.issue_id = i.id and ph.kind = 'after' order by ph.created_at desc limit 1),
         nullif(left(i.details->>'other_label', 80), '')
    from issues i
    left join responsible_parties p on p.id = i.party_id
   where i.duplicate_of is null
   order by i.created_at desc
   limit 300;
end $$;

-- 5. Moderators can move a report to the right category (the person's own words are kept in details).
create or replace function admin_set_category(p_issue uuid, p_category uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  if not exists (select 1 from categories where id = p_category) then
    raise exception 'unknown category' using errcode = '22023';
  end if;
  update issues
     set category_id = p_category,
         details = (coalesce(details, '{}'::jsonb) - 'other_label')
                   || case when details ? 'other_label'
                           then jsonb_build_object('original_label', details->>'other_label')
                           else '{}'::jsonb end
   where id = p_issue;
end $$;

-- Same rule as 005: only signed-in users can call admin functions (each also re-checks is_moderator).
do $$
declare f record;
begin
  for f in
    select oid::regprocedure as sig from pg_proc
     where pronamespace = 'public'::regnamespace
       and (proname like 'admin\_%' or proname in ('is_moderator', 'assert_moderator'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) The "My reports" function still matches the changed view (0 rows is correct in the SQL editor):
select count(*) as my_reports_ok from public.my_reports();
-- B) The new category exists and sorts last:
select c.slug, g.name->>'en' as shown_under, c.enabled, c.sort from categories c join category_groups g on g.id = c.group_id where c.slug = 'other';
-- C) The public view has the new column:
select other_label from public_issues limit 1;

-- ===================== 011_phone_verified.sql =====================
-- 011: phone check, installed but SWITCHED OFF. Run after 009. Safe to run twice.
-- When switched on, confirming a report needs a verified phone; so does a second report within 24 hours.
-- Phone login is paused (SMS providers want a registered business), so this file leaves both rules OFF:
-- nothing changes for residents. Running it again, or running supabase/setup_all.sql again, switches them OFF again.
-- To switch them ON later (only after phone login works end to end), run 011b_enable_phone_rules.sql.
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

-- 3. Leave both rules OFF (phone login is paused). 011b_enable_phone_rules.sql switches them on.
alter table confirmations disable trigger confirmations_need_phone;
alter table issues        disable trigger issues_need_phone;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Both triggers exist and are OFF (tgenabled must show D for both):
select tgname, tgenabled from pg_trigger where tgname in ('confirmations_need_phone', 'issues_need_phone') order by tgname;
-- B) The helper works (false is correct here, because the SQL editor is not a signed-in person):
select is_phone_verified();

-- ===================== 012_districts.sql =====================
-- 012: the 261 Metropolitan, Municipal and District Assemblies as places under their regions.
-- Generated by: node scripts/gen-districts-sql.mjs  (data: data/mmdas.mjs). Safe to run twice.
-- NOT run against a real database by its author: read the checks at the bottom and send me any error.
-- Existing regions and cities stay as they are. A report filed under a district is matched to an office mapped to that
-- district first, then to its region (the matching already climbs the place tree), so nothing existing breaks.

insert into regions (parent_id, level, name)
select reg.id, 'area', v.name
  from regions reg
  join (values
    ('Ahafo', 'Asunafo North Municipal'),
    ('Ahafo', 'Asunafo South District'),
    ('Ahafo', 'Asutifi North District'),
    ('Ahafo', 'Asutifi South District'),
    ('Ahafo', 'Tano North Municipal'),
    ('Ahafo', 'Tano South Municipal'),
    ('Ashanti', 'Adansi Asokwa District'),
    ('Ashanti', 'Adansi North District'),
    ('Ashanti', 'Adansi South District'),
    ('Ashanti', 'Afigya-Kwabre North District'),
    ('Ashanti', 'Afigya-Kwabre South District'),
    ('Ashanti', 'Ahafo-Ano North Municipal'),
    ('Ashanti', 'Ahafo-Ano South East District'),
    ('Ashanti', 'Ahafo-Ano South West District'),
    ('Ashanti', 'Akrofuom District'),
    ('Ashanti', 'Amansie Central District'),
    ('Ashanti', 'Amansie West District'),
    ('Ashanti', 'Amansie South District'),
    ('Ashanti', 'Asante-Akim Central Municipal'),
    ('Ashanti', 'Asante-Akim North District'),
    ('Ashanti', 'Asante-Akim South Municipal'),
    ('Ashanti', 'Asokore-Mampong Municipal'),
    ('Ashanti', 'Asokwa Municipal'),
    ('Ashanti', 'Atwima-Kwanwoma District'),
    ('Ashanti', 'Atwima-Mponua District'),
    ('Ashanti', 'Atwima-Nwabiagya Municipal'),
    ('Ashanti', 'Atwima-Nwabiagya North District'),
    ('Ashanti', 'Bekwai Municipal'),
    ('Ashanti', 'Bosome Freho District'),
    ('Ashanti', 'Bosomtwe District'),
    ('Ashanti', 'Ejisu Municipal'),
    ('Ashanti', 'Ejura/Sekyedumase Municipal'),
    ('Ashanti', 'Juaben Municipal'),
    ('Ashanti', 'Kumasi Metropolitan'),
    ('Ashanti', 'Kwabre East Municipal'),
    ('Ashanti', 'Kwadaso Municipal'),
    ('Ashanti', 'Mampong Municipal'),
    ('Ashanti', 'Obuasi East Municipal'),
    ('Ashanti', 'Obuasi Municipal'),
    ('Ashanti', 'Offinso Municipal'),
    ('Ashanti', 'Offinso North District'),
    ('Ashanti', 'Oforikrom Municipal'),
    ('Ashanti', 'Old Tafo Municipal'),
    ('Ashanti', 'Sekyere Afram Plains District'),
    ('Ashanti', 'Sekyere Central District'),
    ('Ashanti', 'Sekyere East District'),
    ('Ashanti', 'Sekyere Kumawu District'),
    ('Ashanti', 'Sekyere South District'),
    ('Ashanti', 'Suame Municipal'),
    ('Bono', 'Banda District'),
    ('Bono', 'Berekum East Municipal'),
    ('Bono', 'Berekum West District'),
    ('Bono', 'Dormaa Central Municipal'),
    ('Bono', 'Dormaa East District'),
    ('Bono', 'Dormaa West District'),
    ('Bono', 'Jaman North District'),
    ('Bono', 'Jaman South Municipal'),
    ('Bono', 'Sunyani Municipal'),
    ('Bono', 'Sunyani West District'),
    ('Bono', 'Tain District'),
    ('Bono', 'Wenchi Municipal'),
    ('Bono East', 'Atebubu-Amantin Municipal'),
    ('Bono East', 'Kintampo North Municipal'),
    ('Bono East', 'Kintampo South District'),
    ('Bono East', 'Nkoranza North District'),
    ('Bono East', 'Nkoranza South Municipal'),
    ('Bono East', 'Pru East District'),
    ('Bono East', 'Pru West District'),
    ('Bono East', 'Sene East District'),
    ('Bono East', 'Sene West District'),
    ('Bono East', 'Techiman Municipal'),
    ('Bono East', 'Techiman North District'),
    ('Central', 'Abura/Asebu/Kwamankese District'),
    ('Central', 'Agona East District'),
    ('Central', 'Agona West Municipal'),
    ('Central', 'Ajumako/Enyan/Essiam District'),
    ('Central', 'Asikuma Odoben Brakwa District'),
    ('Central', 'Assin Central Municipal'),
    ('Central', 'Assin North District'),
    ('Central', 'Assin South District'),
    ('Central', 'Awutu Senya East Municipal'),
    ('Central', 'Awutu Senya West District'),
    ('Central', 'Cape Coast Metropolitan'),
    ('Central', 'Effutu Municipal'),
    ('Central', 'Ekumfi District'),
    ('Central', 'Gomoa East District'),
    ('Central', 'Gomoa Central District'),
    ('Central', 'Gomoa West District'),
    ('Central', 'Komenda/Edina/Eguafo/Abirem Municipal'),
    ('Central', 'Mfantsiman Municipal'),
    ('Central', 'Twifo Atti Morkwa District'),
    ('Central', 'Twifo/Hemang/Lower Denkyira District'),
    ('Central', 'Upper Denkyira East Municipal'),
    ('Central', 'Upper Denkyira West District'),
    ('Eastern', 'Abuakwa North Municipal'),
    ('Eastern', 'Abuakwa South Municipal'),
    ('Eastern', 'Achiase District'),
    ('Eastern', 'Akuapim North Municipal'),
    ('Eastern', 'Akuapim South District'),
    ('Eastern', 'Akyemansa District'),
    ('Eastern', 'Asene Manso Akroso District'),
    ('Eastern', 'Asuogyaman District'),
    ('Eastern', 'Atiwa East District'),
    ('Eastern', 'Atiwa West District'),
    ('Eastern', 'Ayensuano District'),
    ('Eastern', 'Birim Central Municipal'),
    ('Eastern', 'Birim North District'),
    ('Eastern', 'Birim South District'),
    ('Eastern', 'Denkyembour District'),
    ('Eastern', 'Fanteakwa North District'),
    ('Eastern', 'Fanteakwa South District'),
    ('Eastern', 'Kwaebibirem Municipal'),
    ('Eastern', 'Kwahu Afram Plains North District'),
    ('Eastern', 'Kwahu Afram Plains South District'),
    ('Eastern', 'Kwahu East District'),
    ('Eastern', 'Kwahu South District'),
    ('Eastern', 'Kwahu West Municipal'),
    ('Eastern', 'Lower Manya Krobo Municipal'),
    ('Eastern', 'New Juaben North Municipal'),
    ('Eastern', 'New Juaben South Municipal'),
    ('Eastern', 'Nsawam Adoagyire Municipal'),
    ('Eastern', 'Okere District'),
    ('Eastern', 'Suhum Municipal'),
    ('Eastern', 'Upper Manya Krobo District'),
    ('Eastern', 'Upper West Akim District'),
    ('Eastern', 'West Akim Municipal'),
    ('Eastern', 'Yilo-Krobo Municipal'),
    ('Greater Accra', 'Ablekuma Central Municipal'),
    ('Greater Accra', 'Ablekuma North Municipal'),
    ('Greater Accra', 'Ablekuma West Municipal'),
    ('Greater Accra', 'Accra Metropolitan'),
    ('Greater Accra', 'Ada East District'),
    ('Greater Accra', 'Ada West District'),
    ('Greater Accra', 'Adenta Municipal'),
    ('Greater Accra', 'Ashaiman Municipal'),
    ('Greater Accra', 'Ayawaso Central Municipal'),
    ('Greater Accra', 'Ayawaso East Municipal'),
    ('Greater Accra', 'Ayawaso North Municipal'),
    ('Greater Accra', 'Ayawaso West Municipal'),
    ('Greater Accra', 'Ga Central Municipal'),
    ('Greater Accra', 'Ga East Municipal'),
    ('Greater Accra', 'Ga North Municipal'),
    ('Greater Accra', 'Ga South Municipal'),
    ('Greater Accra', 'Ga West Municipal'),
    ('Greater Accra', 'Korle-Klottey Municipal'),
    ('Greater Accra', 'Kpone-Katamanso Municipal'),
    ('Greater Accra', 'Krowor Municipal'),
    ('Greater Accra', 'La-Dade-Kotopon Municipal'),
    ('Greater Accra', 'La-Nkwantanang-Madina Municipal'),
    ('Greater Accra', 'Ledzokuku Municipal'),
    ('Greater Accra', 'Ningo-Prampram District'),
    ('Greater Accra', 'Okaikwei North Municipal'),
    ('Greater Accra', 'Shai-Osudoku District'),
    ('Greater Accra', 'Tema Metropolitan'),
    ('Greater Accra', 'Tema West Municipal'),
    ('Greater Accra', 'Weija Gbawe Municipal'),
    ('North East', 'Bunkpurugu Nyankpanduri District'),
    ('North East', 'Chereponi District'),
    ('North East', 'East Mamprusi Municipal'),
    ('North East', 'Mamprugu Moagduri District'),
    ('North East', 'West Mamprusi Municipal'),
    ('North East', 'Yunyoo-Nasuan District'),
    ('Northern', 'Gushegu Municipal'),
    ('Northern', 'Karaga District'),
    ('Northern', 'Kpandai District'),
    ('Northern', 'Kumbungu District'),
    ('Northern', 'Mion District'),
    ('Northern', 'Nanton District'),
    ('Northern', 'Nanumba North Municipal'),
    ('Northern', 'Nanumba South District'),
    ('Northern', 'Saboba District'),
    ('Northern', 'Sagnarigu Municipal'),
    ('Northern', 'Savelugu Municipal'),
    ('Northern', 'Tamale Metropolitan'),
    ('Northern', 'Tatale Sanguli District'),
    ('Northern', 'Tolon District'),
    ('Northern', 'Yendi Municipal'),
    ('Northern', 'Zabzugu District'),
    ('Oti', 'Biakoye District'),
    ('Oti', 'Guan District'),
    ('Oti', 'Jasikan Municipal'),
    ('Oti', 'Kadjebi District'),
    ('Oti', 'Krachi East Municipal'),
    ('Oti', 'Krachi Nchumuru District'),
    ('Oti', 'Krachi West Municipal'),
    ('Oti', 'Nkwanta North District'),
    ('Oti', 'Nkwanta South Municipal'),
    ('Savannah', 'Bole District'),
    ('Savannah', 'Central Gonja District'),
    ('Savannah', 'East Gonja Municipal'),
    ('Savannah', 'North Gonja District'),
    ('Savannah', 'North East Gonja District'),
    ('Savannah', 'Sawla-Tuna-Kalba District'),
    ('Savannah', 'West Gonja Municipal'),
    ('Upper East', 'Bawku Municipal'),
    ('Upper East', 'Bawku West District'),
    ('Upper East', 'Binduri District'),
    ('Upper East', 'Bolgatanga East District'),
    ('Upper East', 'Bolgatanga Municipal'),
    ('Upper East', 'Bongo District'),
    ('Upper East', 'Builsa North Municipal'),
    ('Upper East', 'Builsa South District'),
    ('Upper East', 'Garu District'),
    ('Upper East', 'Kassena-Nankana Municipal'),
    ('Upper East', 'Kassena-Nankana West District'),
    ('Upper East', 'Nabdam District'),
    ('Upper East', 'Pusiga District'),
    ('Upper East', 'Talensi District'),
    ('Upper East', 'Tempane District'),
    ('Upper West', 'Daffiama Bussie Issa District'),
    ('Upper West', 'Jirapa Municipal'),
    ('Upper West', 'Lambussie Karni District'),
    ('Upper West', 'Lawra Municipal'),
    ('Upper West', 'Nadowli-Kaleo District'),
    ('Upper West', 'Nandom Municipal'),
    ('Upper West', 'Sissala East Municipal'),
    ('Upper West', 'Sissala West District'),
    ('Upper West', 'Wa East District'),
    ('Upper West', 'Wa Municipal'),
    ('Upper West', 'Wa West District'),
    ('Volta', 'Adaklu District'),
    ('Volta', 'Afadzato South District'),
    ('Volta', 'Agotime Ziope District'),
    ('Volta', 'Akatsi North District'),
    ('Volta', 'Akatsi South District'),
    ('Volta', 'Anloga District'),
    ('Volta', 'Central Tongu District'),
    ('Volta', 'Ho Municipal'),
    ('Volta', 'Ho West District'),
    ('Volta', 'Hohoe Municipal'),
    ('Volta', 'Keta Municipal'),
    ('Volta', 'Ketu North Municipal'),
    ('Volta', 'Ketu South Municipal'),
    ('Volta', 'Kpando Municipal'),
    ('Volta', 'North Dayi District'),
    ('Volta', 'North Tongu District'),
    ('Volta', 'South Dayi District'),
    ('Volta', 'South Tongu District'),
    ('Western', 'Ahanta West Municipal'),
    ('Western', 'Amenfi Central District'),
    ('Western', 'Amenfi West Municipal'),
    ('Western', 'Effia Kwesimintsim Municipal'),
    ('Western', 'Ellembelle District'),
    ('Western', 'Jomoro Municipal'),
    ('Western', 'Mpohor District'),
    ('Western', 'Nzema East Municipal'),
    ('Western', 'Prestea-Huni Valley Municipal'),
    ('Western', 'Sekondi Takoradi Metropolitan'),
    ('Western', 'Shama District'),
    ('Western', 'Tarkwa-Nsuaem Municipal'),
    ('Western', 'Wassa Amenfi East Municipal'),
    ('Western', 'Wassa East District'),
    ('Western North', 'Aowin Municipal'),
    ('Western North', 'Bia East District'),
    ('Western North', 'Bia West District'),
    ('Western North', 'Bibiani Anhwiaso Bekwai Municipal'),
    ('Western North', 'Bodi District'),
    ('Western North', 'Juaboso District'),
    ('Western North', 'Sefwi Akontombra District'),
    ('Western North', 'Sefwi-Wiawso Municipal'),
    ('Western North', 'Suaman District')
  ) as v(region, name) on reg.name = v.region and reg.level = 'region'
on conflict (parent_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- CHECKS. The first stops with an error (and undoes everything) if the total is wrong.
do $$
declare n int;
begin
  select count(*) into n from regions where level = 'area';
  if n <> 261 then raise exception 'Expected 261 districts, found %', n; end if;
end $$;
-- Districts per region (should add up to 261):
select reg.name as region, count(a.id) as districts
  from regions reg
  left join regions a on a.parent_id = reg.id and a.level = 'area'
 where reg.level = 'region'
 group by reg.name
 order by reg.name;

-- ===================== 013_assembly_offices.sql =====================
-- 013: an office for every one of the 261 assemblies, so any report can be assigned to the right one.
-- Run after 012. Safe to run twice. NOT run against a real database by its author: read the checks at the bottom.
-- These offices have a name, a type and an area from the official list, and NO contact details yet. Contacts arrive from
-- moderators, or from community suggestions that a moderator approves. "verified" here means the office is a real,
-- correctly named assembly (that is what makes it appear in the Directory and in the moderator assign list).
-- The public never sees contact details, with or without this migration.

-- 1. The earlier test office for Accra pointed at the old "Accra" city entry. Move it, and the problem types it was
--    mapped to, onto the real district instead of creating a duplicate.
update responsible_parties p
   set region_id = d.id
  from regions c
  join regions d on d.parent_id = c.parent_id and d.level = 'area' and d.name = 'Accra Metropolitan'
 where p.name = 'Accra Metropolitan Assembly' and p.region_id = c.id and c.level = 'city' and c.name = 'Accra';

update category_responsibilities cr
   set region_id = p.region_id
  from responsible_parties p
 where cr.party_id = p.id
   and p.name = 'Accra Metropolitan Assembly'
   and cr.region_id is distinct from p.region_id
   and exists (select 1 from regions r where r.id = cr.region_id and r.level = 'city' and r.name = 'Accra');

-- 2. One office per assembly.
insert into responsible_parties (name, type, region_id, verified)
select a.name || ' Assembly', 'government', a.id, true
  from regions a
 where a.level = 'area'
   and not exists (
     select 1 from responsible_parties p
      where p.region_id = a.id and lower(p.name) = lower(a.name || ' Assembly'));

-- ---------------------------------------------------------------------------
-- CHECKS. The first stops with an error (and undoes everything) if any district has no office.
do $$
declare areas int; covered int;
begin
  select count(*) into areas from regions where level = 'area';
  if areas = 0 then raise exception 'No districts yet: run 012_districts.sql first'; end if;
  select count(distinct r.id) into covered
    from regions r join responsible_parties p on p.region_id = r.id
   where r.level = 'area';
  if covered <> areas then raise exception 'Only % of % districts have an office', covered, areas; end if;
end $$;
-- Offices per region (should add up to at least 261):
select reg.name as region, count(p.id) as offices
  from regions reg
  join regions a on a.parent_id = reg.id and a.level = 'area'
  left join responsible_parties p on p.region_id = a.id
 where reg.level = 'region'
 group by reg.name
 order by reg.name;

-- ===================== 014_lock_down_photo_and_contact_inserts.sql =====================
-- 014: stop visitors writing to other people's reports. Run after 013. Safe to run twice.
-- Before this, any signed-in visitor (including an anonymous one) could:
--   * attach a photo, even an "after" photo, to ANY report (it then shows publicly and satisfies the
--     "resolved needs an after photo" rule for moderators), and
--   * add rows to the public contact log of ANY report (for example "response received: yes").
-- The app only ever needs: a reporter adding the "before" photo to their own report.
-- Moderators keep working through admin_add_after_photo() and admin_log_contact(), which run with owner rights.

-- 1. Photos: only the reporter, only the "before" kind, only a file inside their own folder.
drop policy if exists "add photos" on issue_photos;
drop policy if exists "add own before photo" on issue_photos;
create policy "add own before photo" on issue_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and kind = 'before'
    and (string_to_array(storage_path, '/'))[1] = auth.uid()::text
    and storage_path !~ '\.\.'
    and exists (select 1 from issues i where i.id = issue_id and i.reporter_id = auth.uid())
  );

-- 2. Contact log: no direct writes at all. Moderators use admin_log_contact().
drop policy if exists "log contact" on contact_attempts;

-- 3. Optional: one "before" photo per report. Check for existing duplicates first:
--    select issue_id, count(*) from issue_photos where kind = 'before' group by 1 having count(*) > 1;
--    If that returns no rows, run:
--    create unique index if not exists issue_photos_one_before on issue_photos (issue_id) where kind = 'before';

-- CHECKS (run each as a normal signed-in user in the app, or see the author's test script):
select polname from pg_policy where polrelid in ('issue_photos'::regclass, 'contact_attempts'::regclass) order by 1;
-- expect: add own before photo, contacts readable, photos readable (and NOT: add photos, log contact)

-- ===================== 015_confirmation_quality.sql =====================
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

-- ===================== 016_contact_log_private_notes.sql =====================
-- 016: keep moderators' private notes on the contact log private. Run after 015. Safe to run twice.
-- The public report page only shows the channel, whether a response came, and the date. But the table was
-- readable in full through the API, so anyone could also read the free-text note and who logged the contact.
-- After this, the public can read only the columns the page uses. Moderators are not affected: they log
-- contacts through admin_log_contact(), which runs with owner rights.

revoke select on contact_attempts from anon, authenticated;
grant select (id, issue_id, party_id, channel, response_received, created_at) on contact_attempts to anon, authenticated;

-- CHECK (expect: an error, "permission denied for table contact_attempts"):
--   set role anon;  select note from contact_attempts limit 1;  reset role;
-- CHECK (expect: works):
--   set role anon;  select channel, response_received, created_at from contact_attempts limit 1;  reset role;

-- ===================== 017_merge_anonymous_reports.sql =====================
-- 017: when someone signs in to an existing email account on a phone that already has reports of its own,
-- move those reports into the account they signed in to, instead of leaving them behind. Run after 016. Safe to run twice.
--
-- How it stays safe: before the sign-in link is sent, the phone (still signed in as its anonymous account) asks for a
-- one-time secret "ticket". The database keeps only a fingerprint of it. After the person opens the link and is signed in
-- to their real account, the phone hands the ticket over and the reports move. A ticket works once, for 24 hours, only
-- from an account that still has no email, and only into an account whose email is confirmed. Nobody else can use it,
-- because only that phone ever saw it.
--
-- What moves: reports, photos, confirmations, flags, "is it fixed?" answers, update notices, push alerts, the update-email address and
-- directory suggestions. Public numbers do not change, except that a confirmation the person already made with
-- their other account is not counted twice, and nobody is left "confirming" their own report.

create table if not exists merge_tickets (
  token_hash text primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table merge_tickets enable row level security;   -- no policies: only the functions below can touch it
revoke all on merge_tickets from anon, authenticated;

-- Step 1, on the old phone while it is still anonymous. Returns the secret ticket (shown once; only its fingerprint is kept).
create or replace function create_merge_ticket() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_ticket text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous is true) then
    raise exception 'not_anonymous';                       -- an account that already has an email has nothing to merge
  end if;
  delete from merge_tickets where from_user = v_uid;      -- one live ticket per account
  v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into merge_tickets (token_hash, from_user, expires_at)
    values (encode(sha256(convert_to(v_ticket, 'UTF8')), 'hex'), v_uid, now() + interval '24 hours');
  return v_ticket;
end $$;

-- Step 2, after signing in to the real account. Returns {"moved": number of reports}.
create or replace function claim_merge_ticket(p_ticket text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_to   uuid := auth.uid();
  v_hash text := encode(sha256(convert_to(coalesce(p_ticket, ''), 'UTF8')), 'hex');
  v_from uuid;
  v_moved int := 0;
begin
  if v_to is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_to and u.email_confirmed_at is not null) then
    raise exception 'not_permanent';                       -- only into an account whose email is confirmed
  end if;

  select t.from_user into v_from from merge_tickets t
   where t.token_hash = v_hash and t.used_at is null and t.expires_at > now() for update;
  if v_from is null then raise exception 'ticket_invalid'; end if;

  if v_from = v_to then                                    -- opened where they were already signed in: nothing to move
    update merge_tickets set used_at = now() where token_hash = v_hash;
    return jsonb_build_object('moved', 0);
  end if;
  if not exists (select 1 from auth.users u where u.id = v_from and u.is_anonymous is true) then
    raise exception 'ticket_invalid';                      -- the old account is no longer a plain anonymous one
  end if;

  update issues set reporter_id = v_to where reporter_id = v_from;
  get diagnostics v_moved = row_count;
  update issue_photos set uploaded_by = v_to where uploaded_by = v_from;

  -- Confirmations: never count one person twice, and never leave someone confirming their own report.
  with gone as (
    delete from confirmations c
     where (c.user_id = v_from and (exists (select 1 from confirmations b where b.issue_id = c.issue_id and b.user_id = v_to)
                                    or exists (select 1 from issues i where i.id = c.issue_id and i.reporter_id = v_to)))
        or (c.user_id = v_to and exists (select 1 from issues i where i.id = c.issue_id and i.reporter_id = v_to))
    returning c.issue_id, coalesce(c.counts, true) as counted
  )
  update issues i set confirmation_count = greatest(0, i.confirmation_count - g.n)
    from (select issue_id, count(*) filter (where counted) as n from gone group by issue_id) g
   where i.id = g.issue_id and g.n > 0;
  update confirmations set user_id = v_to where user_id = v_from;

  delete from flags f where f.user_id = v_from and exists (select 1 from flags b where b.issue_id = f.issue_id and b.user_id = v_to);
  update flags set user_id = v_to where user_id = v_from;

  if to_regclass('public.fix_checks') is not null then       -- "Is it fixed?" answers (019), when that migration has been run
    execute 'delete from fix_checks f where f.user_id = $1 and exists (select 1 from fix_checks b where b.issue_id = f.issue_id and b.cycle = f.cycle and b.user_id = $2)' using v_from, v_to;
    execute 'update fix_checks set user_id = $2 where user_id = $1' using v_from, v_to;
  end if;
  update notifications set user_id = v_to where user_id = v_from;
  update push_subscriptions set user_id = v_to where user_id = v_from;
  delete from notification_contacts where user_id = v_from and exists (select 1 from notification_contacts where user_id = v_to);
  update notification_contacts set user_id = v_to where user_id = v_from;
  update directory_suggestions set suggested_by = v_to where suggested_by = v_from;

  update merge_tickets set used_at = now() where token_hash = v_hash;
  return jsonb_build_object('moved', v_moved);
end $$;

revoke all on function create_merge_ticket() from public, anon, authenticated;
revoke all on function claim_merge_ticket(text) from public, anon, authenticated;
grant execute on function create_merge_ticket() to authenticated;   -- anonymous sign-ins use this role too
grant execute on function claim_merge_ticket(text) to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Only signed-in visitors can call the two functions (expect: anon_can f, signed_in_can t for both):
select has_function_privilege('anon', 'create_merge_ticket()', 'execute') as anon_can,
       has_function_privilege('authenticated', 'create_merge_ticket()', 'execute') as signed_in_can,
       has_function_privilege('anon', 'claim_merge_ticket(text)', 'execute') as anon_can_claim,
       has_function_privilege('authenticated', 'claim_merge_ticket(text)', 'execute') as signed_in_can_claim;
-- B) Nobody can read the ticket table through the API (expect: f, f):
select has_table_privilege('anon', 'merge_tickets', 'select') as anon_reads, has_table_privilege('authenticated', 'merge_tickets', 'select') as signed_in_reads;

-- ===================== 018_auth_email_throttle.sql =====================
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

-- ===================== 019_fix_checks.sql =====================
-- 019: "Is it fixed?" Once a report is marked resolved, the people who know it best (the person who reported it and
-- those who confirmed it) can answer Fixed / Partly / Not fixed. If enough of them say it is not really fixed, the report
-- reopens and goes back to the responsible party with its ORIGINAL sent date, so the waiting time keeps counting against them
-- on the tracker. Run after 018. Safe to run twice.
--
-- Rules (change the numbers marked RULE and run this file again):
--   * Only the reporter and people who confirmed the report can answer, once each per round (they can change their answer).
--   * A report reopens when "Not fixed" + "Partly" answers reach 2 AND outnumber "Fixed". If only the reporter ever
--     took part, 1 is enough.                                                                       -- RULE
--   * It can reopen automatically at most twice (reopen_count). After that answers are still shown, but a moderator decides.  -- RULE
-- Nobody's identity is exposed: the public sees only the totals.

alter table issues add column if not exists reopen_count int not null default 0;

create table if not exists fix_checks (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  cycle      int  not null,                       -- = issues.reopen_count when the answer was given
  answer     text not null check (answer in ('fixed', 'partly', 'not_fixed')),
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id, cycle)
);
alter table fix_checks enable row level security;   -- no policies: only the functions below can touch it
revoke all on fix_checks from anon, authenticated;

-- Public totals for the current round, never who answered.
create or replace view public_fix_checks as
select i.id as issue_id, i.reopen_count,
       count(c.*) filter (where c.answer = 'fixed')     as fixed,
       count(c.*) filter (where c.answer = 'partly')    as partly,
       count(c.*) filter (where c.answer = 'not_fixed') as not_fixed
  from issues i
  left join fix_checks c on c.issue_id = i.id and c.cycle = i.reopen_count
 where i.status <> 'rejected' and i.duplicate_of is null
 group by i.id, i.reopen_count;
grant select on public_fix_checks to anon, authenticated;

-- Can this visitor answer, and what did they say? {"eligible": bool, "answer": text|null}
create or replace function my_fix_check(p_issue uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', i.status = 'resolved' and auth.uid() is not null
                and (i.reporter_id = auth.uid() or exists (select 1 from confirmations c where c.issue_id = i.id and c.user_id = auth.uid())),
    'answer', (select f.answer from fix_checks f where f.issue_id = i.id and f.user_id = auth.uid() and f.cycle = i.reopen_count))
  from issues i where i.id = p_issue;
$$;

-- A new notification wording for "reopened" is sent below, so the ordinary "sent" notice must not fire as well.
create or replace function public.notify_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.to_status::text = 'reported' then return new; end if;
  if current_setting('civic.skip_notify', true) = 'on' then return new; end if;
  begin
    insert into public.notifications (user_id, issue_id, to_status)
    select distinct f.user_id, new.issue_id, new.to_status::text
    from (
      select reporter_id as user_id from public.issues where id = new.issue_id
      union
      select user_id from public.confirmations where issue_id = new.issue_id
    ) f
    where f.user_id is not null;
  exception when others then
    raise warning 'notify_status_change failed: %', sqlerrm;
  end;
  return new;
end $$;

create or replace function submit_fix_check(p_issue uuid, p_answer text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  i issues%rowtype;
  v_eligible int;
  v_bad int; v_good int; v_need int;
  v_reopened boolean := false;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_answer not in ('fixed', 'partly', 'not_fixed') then raise exception 'bad_answer'; end if;

  select * into i from issues where id = p_issue for update;     -- one answer at a time per report
  if not found or i.status <> 'resolved' then raise exception 'not_resolved'; end if;
  if not (i.reporter_id = v_uid or exists (select 1 from confirmations c where c.issue_id = i.id and c.user_id = v_uid)) then
    raise exception 'not_involved';
  end if;

  insert into fix_checks (issue_id, user_id, cycle, answer) values (i.id, v_uid, i.reopen_count, p_answer)
  on conflict (issue_id, user_id, cycle) do update set answer = excluded.answer, created_at = now();

  select count(*) filter (where answer in ('partly', 'not_fixed')), count(*) filter (where answer = 'fixed') into v_bad, v_good
    from fix_checks where issue_id = i.id and cycle = i.reopen_count;
  select 1 + count(distinct c.user_id) filter (where c.user_id <> coalesce(i.reporter_id, v_uid)) into v_eligible from confirmations c where c.issue_id = i.id;
  v_need := least(2, v_eligible);                                                                  -- RULE

  if v_bad >= v_need and v_bad > v_good and i.reopen_count < 2 then                                -- RULE
    perform set_config('civic.skip_notify', 'on', true);
    update issues
       set status = case when party_id is not null then 'sent'::issue_status else 'verified'::issue_status end,
           resolved_at = null, reopen_count = reopen_count + 1
     where id = i.id;
    perform set_config('civic.skip_notify', '', true);
    update status_log set note = 'reopened_by_neighbours'
     where id = (select max(l.id) from status_log l where l.issue_id = i.id);
    insert into notifications (user_id, issue_id, to_status)
      select distinct f.user_id, i.id, 'reopened'
        from (select i.reporter_id as user_id union select user_id from confirmations where issue_id = i.id) f
       where f.user_id is not null;
    v_reopened := true;
  end if;
  return jsonb_build_object('answer', p_answer, 'reopened', v_reopened);
end $$;

revoke all on function my_fix_check(uuid) from public, anon, authenticated;
revoke all on function submit_fix_check(uuid, text) from public, anon, authenticated;
grant execute on function my_fix_check(uuid) to authenticated;
grant execute on function submit_fix_check(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Nobody can read who answered (expect: f, f):
select has_table_privilege('anon', 'fix_checks', 'select') as anon_reads, has_table_privilege('authenticated', 'fix_checks', 'select') as signed_in_reads;
-- B) The public totals work (expect a row count, no error):
select count(*) from public_fix_checks;

-- ===================== 020_admin_fix_checks.sql =====================
-- 020: lets moderators see the "Is it fixed?" answers and how often reports were reopened. Run after 019. Safe to run twice.
-- Moderators only, and still totals only: who answered stays private even from moderators.
create or replace function admin_fix_check_summary() returns table (
  issue_id uuid, reopen_count int, fixed int, partly int, not_fixed int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'not_moderator' using errcode = '42501'; end if;
  return query
  select i.id, i.reopen_count,
         (count(c.*) filter (where c.answer = 'fixed'))::int,
         (count(c.*) filter (where c.answer = 'partly'))::int,
         (count(c.*) filter (where c.answer = 'not_fixed'))::int
    from issues i
    left join fix_checks c on c.issue_id = i.id and c.cycle = i.reopen_count
   where i.duplicate_of is null
   group by i.id, i.reopen_count
  having i.reopen_count > 0 or count(c.*) > 0;
end $$;
revoke all on function admin_fix_check_summary() from public, anon, authenticated;
grant execute on function admin_fix_check_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) The public cannot call it (expect: f, t):
select has_function_privilege('anon', 'admin_fix_check_summary()', 'execute') as anon_can, has_function_privilege('authenticated', 'admin_fix_check_summary()', 'execute') as signed_in_can;
-- B) As a moderator in the app, the Admin page now has a "Disputed fixes" tab.
