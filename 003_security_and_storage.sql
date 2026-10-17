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
