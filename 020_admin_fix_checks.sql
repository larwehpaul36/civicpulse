-- 020: lets moderators see the "Is it fixed?" answers and how often reports were reopened. Run after 019. Safe to run twice.
-- Moderators only, and still totals only: who answered stays private even from moderators.
create or replace function admin_fix_check_summary() returns table (
  issue_id uuid, reopen_count int, fixed int, partly int, not_fixed int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'not_moderator' using errcode = '42501'; end if;
  return query
  select i.id, i.reopen_count,
         (count(c.*) filter (where c.answer = 'fixed'))::int,
         (count(c.*) filter (where c.answer = 'partly'))::int,
         (count(c.*) filter (where c.answer = 'not_fixed'))::int
    from issues i
    left join fix_checks c on c.issue_id = i.id and c.cycle = i.reopen_count
   where i.duplicate_of is null
   group by i.id, i.reopen_count
  having i.reopen_count > 0 or count(c.*) > 0;
end $$;
revoke all on function admin_fix_check_summary() from public, anon, authenticated;
grant execute on function admin_fix_check_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) The public cannot call it (expect: f, t):
select has_function_privilege('anon', 'admin_fix_check_summary()', 'execute') as anon_can, has_function_privilege('authenticated', 'admin_fix_check_summary()', 'execute') as signed_in_can;
-- B) As a moderator in the app, the Admin page now has a "Disputed fixes" tab.
