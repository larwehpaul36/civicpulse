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
