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
