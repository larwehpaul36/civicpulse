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
