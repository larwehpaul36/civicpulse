-- 021: office right of reply. Run after 020. Safe to run twice.
-- An office can answer a report in public: a short reply, an expected fix date, or "this is not our job".
-- First version: a MODERATOR records the reply on the office's behalf (it arrives by WhatsApp, a call or a visit),
-- and the public page shows it as "relayed by CivicPulse". Offices do not sign in yet.
-- Replies are append-only for everyone, including moderators. A mistake or abuse is hidden (removed_at), never edited,
-- so the record stays checkable. Hidden replies disappear from the public view.

create table if not exists office_replies (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references issues(id) on delete cascade,
  party_id      uuid references responsible_parties(id) on delete set null,
  kind          text not null check (kind in ('reply', 'expected_date', 'not_ours')),
  body          text check (body is null or char_length(body) <= 500),
  expected_date date,
  relayed_by    uuid,            -- the moderator; never shown to the public
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,
  removed_by    uuid,
  constraint reply_needs_text  check (kind = 'expected_date' or char_length(btrim(coalesce(body, ''))) > 0),
  constraint date_needs_date   check (kind <> 'expected_date' or expected_date is not null)
);
create index if not exists office_replies_issue_idx on office_replies (issue_id, created_at);

alter table office_replies enable row level security;
drop policy if exists "replies readable" on office_replies;
create policy "replies readable" on office_replies for select
  using (removed_at is null and exists (select 1 from issues i where i.id = issue_id));  -- issues' own RLS hides rejected ones

-- Nobody writes directly. The public sees only what the page shows (not who relayed it, not removal details).
revoke all on office_replies from anon, authenticated;
grant select (id, issue_id, party_id, kind, body, expected_date, created_at) on office_replies to anon, authenticated;

create or replace function public.admin_add_office_reply(
  p_issue uuid, p_kind text, p_body text default null, p_expected date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_party uuid; v_id uuid; v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  perform assert_moderator();
  if p_kind is null or p_kind not in ('reply', 'expected_date', 'not_ours') then raise exception 'bad_kind'; end if;
  select party_id into v_party from issues where id = p_issue;
  if not found then raise exception 'issue_not_found'; end if;
  if v_party is null then raise exception 'no_party'; end if;               -- a reply must belong to an office
  if p_kind <> 'expected_date' and v_body is null then raise exception 'text_required'; end if;
  if v_body is not null and char_length(v_body) > 500 then raise exception 'too_long'; end if;
  if p_kind = 'expected_date' then
    if p_expected is null then raise exception 'date_required'; end if;
    if p_expected < current_date or p_expected > current_date + 365 then raise exception 'bad_date'; end if;
  else
    p_expected := null;
  end if;
  insert into office_replies (issue_id, party_id, kind, body, expected_date, relayed_by)
  values (p_issue, v_party, p_kind, v_body, p_expected, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_hide_office_reply(p_reply uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_moderator();
  update office_replies set removed_at = now(), removed_by = auth.uid() where id = p_reply and removed_at is null;
end $$;

-- Moderators see everything (including hidden ones and who relayed them) through this.
create or replace function public.admin_list_office_replies(p_issue uuid)
returns table (id uuid, kind text, body text, expected_date date, created_at timestamptz, removed_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_moderator();
  return query select r.id, r.kind, r.body, r.expected_date, r.created_at, r.removed_at
               from office_replies r where r.issue_id = p_issue order by r.created_at;
end $$;

revoke all on function public.admin_add_office_reply(uuid, text, text, date) from public, anon;
revoke all on function public.admin_hide_office_reply(uuid) from public, anon;
revoke all on function public.admin_list_office_replies(uuid) from public, anon;
grant execute on function public.admin_add_office_reply(uuid, text, text, date) to authenticated;
grant execute on function public.admin_hide_office_reply(uuid) to authenticated;
grant execute on function public.admin_list_office_replies(uuid) to authenticated;

-- CHECK (expect: permission denied): set role anon; select relayed_by from office_replies limit 1; reset role;
-- CHECK (expect: works):             set role anon; select kind, body, expected_date from office_replies limit 1; reset role;
