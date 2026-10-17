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
