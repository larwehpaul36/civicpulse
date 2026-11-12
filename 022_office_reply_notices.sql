-- 022: tell the people who follow a report when its office replies. Run after 021. Safe to run twice.
-- Followers are the reporter and everyone who confirmed it (same rule as 007). They get an in-app update on /my, and push or
-- email if they switched those on, through the same `notify` function and Database Webhook as status changes. No new webhook.
-- The notice never contains the reply text: push messages show on lock screens, and the full reply is one tap away on the report page.
-- To keep it from becoming noise: someone who already has an UNREAD notice of the same kind for the same report gets no second one.
-- A problem here must never stop the moderator recording the reply, so errors are logged, not raised.

create or replace function public.notify_office_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text := case new.kind when 'reply' then 'office_reply' when 'expected_date' then 'office_date' else 'office_not_ours' end;
begin
  begin
    insert into public.notifications (user_id, issue_id, to_status)
    select distinct f.user_id, new.issue_id, v_kind
    from (
      select reporter_id as user_id from public.issues where id = new.issue_id
      union
      select user_id from public.confirmations where issue_id = new.issue_id
    ) f
    where f.user_id is not null
      and not exists (select 1 from public.notifications n
                      where n.user_id = f.user_id and n.issue_id = new.issue_id and n.to_status = v_kind and n.read_at is null);
  exception when others then
    raise warning 'notify_office_reply failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_office_reply on public.office_replies;
create trigger notify_office_reply after insert on public.office_replies
  for each row execute function public.notify_office_reply();

-- CHECK: add a test reply as a moderator in /admin, then in the SQL editor:
--   select user_id, to_status, created_at from notifications where to_status like 'office_%' order by created_at desc limit 5;
