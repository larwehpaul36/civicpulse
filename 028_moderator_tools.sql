-- 028: moderator tools. Run after 027. Safe to run twice.
--   1. A record of who did what (moderator_log). It is written by database triggers, so every route is covered:
--      the admin screen, a bulk action, or someone running SQL as a signed-in moderator. Nobody can edit or delete it from the app.
--   2. Bulk actions: change status, assign an office, or dismiss flags on up to 50 reports at once. Each report is checked
--      on its own (same rules as one at a time, e.g. "resolved" still needs an after photo) and the answer says which worked.
--   3. admin_activity(): the record, newest first, for moderators only.
-- Nothing here is visible to the public. Moderator emails are personal data, so the table is private.

create table if not exists moderator_log (
  id           bigint generated always as identity primary key,
  moderator_id uuid not null,
  action       text not null,
  issue_id     uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists moderator_log_time_idx  on moderator_log (created_at desc);
create index if not exists moderator_log_issue_idx on moderator_log (issue_id, created_at desc);
alter table moderator_log enable row level security;           -- no policies: only the functions below touch it
revoke all on moderator_log from anon, authenticated;

-- Internal writer. Records only when the CURRENT user is a moderator (residents' own actions are not logged here).
create or replace function public.log_moderator(p_action text, p_issue uuid, p_detail jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_batch text := nullif(current_setting('civicpulse.batch', true), '');
begin
  if auth.uid() is null or not is_moderator() then return; end if;
  insert into moderator_log (moderator_id, action, issue_id, detail)
  values (auth.uid(), p_action, p_issue,
          coalesce(p_detail, '{}'::jsonb) || case when v_batch is null then '{}'::jsonb else jsonb_build_object('batch', v_batch) end);
end $$;
revoke all on function public.log_moderator(text, uuid, jsonb) from public, anon, authenticated;

-- ---- triggers ----
create or replace function public.trg_log_issue_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform log_moderator('status', new.id, jsonb_build_object('from', old.status::text, 'to', new.status::text));
  end if;
  if new.party_id is distinct from old.party_id then
    perform log_moderator('assign_office', new.id, jsonb_build_object('from', old.party_id, 'to', new.party_id));
  end if;
  if new.category_id is distinct from old.category_id then
    perform log_moderator('category', new.id, jsonb_build_object('from', old.category_id, 'to', new.category_id));
  end if;
  return null;
end $$;
drop trigger if exists trg_log_issue_change on issues;
create trigger trg_log_issue_change after update on issues for each row execute function trg_log_issue_change();

create or replace function public.trg_log_flags_dismissed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_moderator('dismiss_flags', old.issue_id, jsonb_build_object('reason', old.reason));
  return null;
end $$;
drop trigger if exists trg_log_flags_dismissed on flags;
create trigger trg_log_flags_dismissed after delete on flags for each row execute function trg_log_flags_dismissed();

create or replace function public.trg_log_reply_hidden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.removed_at is null and new.removed_at is not null then
    perform log_moderator('hide_reply', new.issue_id, jsonb_build_object('reply', new.id));
  end if;
  return null;
end $$;
drop trigger if exists trg_log_reply_hidden on office_replies;
create trigger trg_log_reply_hidden after update on office_replies for each row execute function trg_log_reply_hidden();

create or replace function public.trg_log_staff_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_moderator('invite_staff', null, jsonb_build_object('party', new.party_id, 'email', new.email));
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform log_moderator('revoke_staff', null, jsonb_build_object('party', new.party_id, 'email', new.email));
  end if;
  return null;
end $$;
drop trigger if exists trg_log_staff_change on office_staff;
create trigger trg_log_staff_change after insert or update on office_staff for each row execute function trg_log_staff_change();

-- ---- bulk actions ----
-- Each report runs in its own sub-transaction, so one failure does not undo the others.
create or replace function public.admin_bulk_set_status(p_ids uuid[], p_status issue_status, p_note text default null)
returns table (issue_id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform assert_moderator();
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_selected'; end if;
  if array_length(p_ids, 1) > 50 then raise exception 'too_many'; end if;
  perform set_config('civicpulse.batch', gen_random_uuid()::text, true);
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      perform admin_set_status(v_id, p_status, p_note);
      issue_id := v_id; ok := true; error := null; return next;
    exception when others then
      issue_id := v_id; ok := false; error := sqlerrm; return next;
    end;
  end loop;
end $$;

create or replace function public.admin_bulk_assign_party(p_ids uuid[], p_party uuid)
returns table (issue_id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform assert_moderator();
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_selected'; end if;
  if array_length(p_ids, 1) > 50 then raise exception 'too_many'; end if;
  if not exists (select 1 from responsible_parties where id = p_party) then raise exception 'party_not_found'; end if;
  perform set_config('civicpulse.batch', gen_random_uuid()::text, true);
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      if not exists (select 1 from issues where id = v_id) then raise exception 'not_found'; end if;
      -- p_remember = false: a bulk choice must not teach the system a default for every category and region
      perform admin_assign_party(v_id, p_party, false);
      issue_id := v_id; ok := true; error := null; return next;
    exception when others then
      issue_id := v_id; ok := false; error := sqlerrm; return next;
    end;
  end loop;
end $$;

create or replace function public.admin_bulk_dismiss_flags(p_ids uuid[])
returns table (issue_id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform assert_moderator();
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'nothing_selected'; end if;
  if array_length(p_ids, 1) > 50 then raise exception 'too_many'; end if;
  perform set_config('civicpulse.batch', gen_random_uuid()::text, true);
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      perform admin_dismiss_flags(v_id);
      issue_id := v_id; ok := true; error := null; return next;
    exception when others then
      issue_id := v_id; ok := false; error := sqlerrm; return next;
    end;
  end loop;
end $$;

-- ---- the record ----
create or replace function public.admin_activity(p_limit int default 100, p_issue uuid default null)
returns table (id bigint, created_at timestamptz, moderator_email text, moderator_id uuid, action text, issue_id uuid, detail jsonb)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform assert_moderator();
  return query
    select l.id, l.created_at, u.email::text, l.moderator_id, l.action, l.issue_id, l.detail
      from moderator_log l
      left join auth.users u on u.id = l.moderator_id
     where p_issue is null or l.issue_id = p_issue
     order by l.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

revoke all on function public.admin_bulk_set_status(uuid[], issue_status, text) from public, anon;
revoke all on function public.admin_bulk_assign_party(uuid[], uuid) from public, anon;
revoke all on function public.admin_bulk_dismiss_flags(uuid[]) from public, anon;
revoke all on function public.admin_activity(int, uuid) from public, anon;
grant execute on function public.admin_bulk_set_status(uuid[], issue_status, text) to authenticated;
grant execute on function public.admin_bulk_assign_party(uuid[], uuid) to authenticated;
grant execute on function public.admin_bulk_dismiss_flags(uuid[]) to authenticated;
grant execute on function public.admin_activity(int, uuid) to authenticated;

-- CHECK (expect: false, true, false, true):
--   select has_table_privilege('authenticated', 'moderator_log', 'select'),
--          has_function_privilege('authenticated', 'admin_activity(int, uuid)', 'execute'),
--          has_function_privilege('anon', 'admin_bulk_set_status(uuid[], issue_status, text)', 'execute'),
--          exists (select 1 from pg_trigger where tgname = 'trg_log_issue_change');
