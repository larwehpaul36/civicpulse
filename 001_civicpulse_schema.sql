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
