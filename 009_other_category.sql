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
