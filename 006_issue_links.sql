-- 006_issue_links.sql
-- Run after 001-005, in the Supabase SQL editor.
-- Lets moderators link reports about the same problem, or about a related one.
-- The issue_links table already exists (001) and anyone can read it.
-- Nobody can write to it directly; the two functions below are the only way, and they check assert_moderator().

create or replace function public.admin_link_issues(
  p_a uuid,
  p_b uuid,
  p_relation text default 'related'   -- 'related' or 'duplicate' (the same problem reported twice)
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first uuid;
  v_second uuid;
begin
  perform public.assert_moderator();

  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'same_issue';
  end if;
  if p_relation is null or p_relation not in ('related', 'duplicate') then
    raise exception 'bad_relation';
  end if;
  if (select count(*) from public.issues where id in (p_a, p_b)) <> 2 then
    raise exception 'issue_not_found';
  end if;

  -- One row per pair: the smaller id goes first, so (a, b) and (b, a) can never both exist.
  v_first := least(p_a, p_b);
  v_second := greatest(p_a, p_b);

  delete from public.issue_links where issue_a = v_second and issue_b = v_first;

  insert into public.issue_links (issue_a, issue_b, relation)
  values (v_first, v_second, p_relation)
  on conflict (issue_a, issue_b) do update set relation = excluded.relation;
end;
$$;

create or replace function public.admin_unlink_issues(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_moderator();

  delete from public.issue_links
  where (issue_a = p_a and issue_b = p_b)
     or (issue_a = p_b and issue_b = p_a);
end;
$$;

revoke all on function public.admin_link_issues(uuid, uuid, text) from public, anon;
revoke all on function public.admin_unlink_issues(uuid, uuid) from public, anon;
grant execute on function public.admin_link_issues(uuid, uuid, text) to authenticated;
grant execute on function public.admin_unlink_issues(uuid, uuid) to authenticated;
