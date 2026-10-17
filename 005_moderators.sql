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
