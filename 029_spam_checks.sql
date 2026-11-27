-- 029: spam and fake-report checks. Run after 028. Safe to run twice. No cost, no new service.
--   1. Reporting speed limit per account: at most 5 reports in 10 minutes and 10 in 24 hours (offline queues still fit).
--   2. Location check: a report must be inside Ghana (a generous box), so a stray GPS fix or a made-up place is refused.
--   3. Flag limit: one account can flag at most 20 reports in 24 hours, so "flag" cannot be used to attack honest reports.
--   4. admin_spam_review(): a list of open reports that look suspicious and WHY. It only suggests. A moderator decides.
--      Nothing is hidden or rejected automatically, so an honest report is never removed by a rule.
-- Moderators and SQL-editor writes are never limited. An account that is not signed in cannot insert anyway.
-- Honest limit: someone who can make unlimited fresh anonymous accounts can get round per-account limits. The real wall
-- against that is the captcha on sign-in (Turnstile). These checks are the second layer.

-- 1 + 2. Reports
create or replace function public.check_report_abuse() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_lat double precision; v_lng double precision;
begin
  if auth.uid() is null or is_moderator() then return new; end if;
  if new.reporter_id is not null then
    if (select count(*) from issues where reporter_id = new.reporter_id and created_at > now() - interval '10 minutes') >= 5      -- LIMIT: per 10 minutes
       or (select count(*) from issues where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 10 then -- LIMIT: per 24 hours
      raise exception 'report_rate_limited' using errcode = 'CP001';
    end if;
  end if;
  v_lat := st_y(new.location::geometry); v_lng := st_x(new.location::geometry);
  if v_lat is null or v_lng is null or v_lat not between 4.5 and 11.3 or v_lng not between -3.4 and 1.3 then   -- Ghana, with room at the edges
    raise exception 'outside_ghana' using errcode = 'CP002';
  end if;
  return new;
end $$;
drop trigger if exists issues_abuse_check on issues;
create trigger issues_abuse_check before insert on issues for each row execute function check_report_abuse();

-- 3. Flags
create or replace function public.check_flag_abuse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_moderator() then return new; end if;
  if (select count(*) from flags where user_id = new.user_id and created_at > now() - interval '24 hours') >= 20 then   -- LIMIT: per 24 hours
    raise exception 'flag_rate_limited' using errcode = 'CP003';
  end if;
  return new;
end $$;
drop trigger if exists flags_abuse_check on flags;
create trigger flags_abuse_check before insert on flags for each row execute function check_flag_abuse();

-- 4. The review list. Reasons: flagged (2+ flags), burst (3+ reports from one account within a day of this one),
-- same_text (the same words appear in another report), link (a web address in the text), number (a long phone-like number in the text),
-- new_account (the account was under 10 minutes old when it reported). A report is listed at 2 points or more.
create or replace function public.admin_spam_review()
returns table (issue_id uuid, score int, reasons text[])
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform assert_moderator();
  return query
  with base as (
    select i.id, i.reporter_id, i.created_at,
           lower(regexp_replace(btrim(coalesce(i.description, '')), '\s+', ' ', 'g')) as norm,
           coalesce(i.description, '') as raw
      from issues i
     where i.duplicate_of is null and i.status::text not in ('resolved', 'rejected')
  ), sig as (
    select b.id,
      (select count(*) from flags f where f.issue_id = b.id) >= 2 as flagged,
      b.reporter_id is not null and (select count(*) from issues o where o.reporter_id = b.reporter_id
          and o.created_at between b.created_at - interval '1 day' and b.created_at + interval '1 day') >= 3 as burst,
      char_length(b.norm) >= 12 and exists (select 1 from issues o where o.id <> b.id
          and lower(regexp_replace(btrim(coalesce(o.description, '')), '\s+', ' ', 'g')) = b.norm
          and o.created_at between b.created_at - interval '30 days' and b.created_at + interval '30 days') as same_text,
      b.raw ~* '(https?://|www\.)' as link,
      b.raw ~ '(\d[\s-]?){9,}' as number,
      coalesce((select b.created_at - u.created_at < interval '10 minutes' from auth.users u where u.id = b.reporter_id), false) as new_account
    from base b
  ), scored as (
    select s.id,
           (case when s.flagged then 2 else 0 end + case when s.burst then 2 else 0 end + case when s.same_text then 2 else 0 end
            + case when s.link then 2 else 0 end + case when s.number then 1 else 0 end + case when s.new_account then 1 else 0 end)::int as score,
           array_remove(array[case when s.flagged then 'flagged' end, case when s.burst then 'burst' end, case when s.same_text then 'same_text' end,
                              case when s.link then 'link' end, case when s.number then 'number' end, case when s.new_account then 'new_account' end], null) as reasons
      from sig s
  )
  select sc.id, sc.score, sc.reasons from scored sc where sc.score >= 2 order by sc.score desc, sc.id limit 300;
end $$;

revoke all on function public.admin_spam_review() from public, anon;
grant execute on function public.admin_spam_review() to authenticated;

-- CHECK (expect: true, true, false): both triggers exist, and anonymous people cannot call the review list.
--   select exists (select 1 from pg_trigger where tgname = 'issues_abuse_check') and exists (select 1 from pg_trigger where tgname = 'flags_abuse_check'),
--          has_function_privilege('authenticated', 'admin_spam_review()', 'execute'),
--          has_function_privilege('anon', 'admin_spam_review()', 'execute');
