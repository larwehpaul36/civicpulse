-- 007_notifications.sql
-- Run after 001-006, in the Supabase SQL editor.
-- Tells reporters (and the neighbours who confirmed a report) when its status changes.
--   1. In-app: every status change adds a row to `notifications`; people read their own rows.
--   2. Web push: browsers register in `push_subscriptions`; an Edge Function sends the push.
--   3. Email (optional, off in the app until NEXT_PUBLIC_EMAIL_NOTICES=1): `notification_contacts`
--      holds a verified address, with a one-click unsubscribe.
-- Sending (push and email) is done by the `notify` Edge Function, fed by a Database Webhook.
-- Nothing here can be written from the app directly; every write goes through the functions below.

-- ---------------------------------------------------------------- in-app feed
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id uuid not null references public.issues(id) on delete cascade,
  to_status text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- On every status change: one notification for the reporter and one for each person who confirmed.
-- A problem here must never block the status change itself, so errors are logged, not raised.
create or replace function public.notify_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.to_status::text = 'reported' then
    return new;
  end if;
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
end;
$$;

drop trigger if exists notify_status_change on public.status_log;
create trigger notify_status_change after insert on public.status_log
  for each row execute function public.notify_status_change();

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- The reports this browser's anonymous account made, in the same shape as the public list.
create or replace function public.my_reports()
returns setof public.public_issues
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.public_issues p
  where p.id in (select i.id from public.issues i where i.reporter_id = auth.uid());
$$;

-- ---------------------------------------------------------------- web push
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;   -- no policies: only the service role reads this
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'bad_endpoint';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, clock_timestamp())
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, created_at = clock_timestamp();

  -- keep the five newest per account
  delete from public.push_subscriptions
  where user_id = auth.uid()
    and endpoint not in (
      select endpoint from public.push_subscriptions where user_id = auth.uid() order by created_at desc, endpoint limit 5
    );
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- optional email
-- One address per anonymous account. Nothing is sent until the owner clicks the link in a
-- verification email, so nobody can sign up somebody else's address.
create table if not exists public.notification_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  consent_at timestamptz not null default now(),
  verify_token uuid not null default gen_random_uuid(),
  verified_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);
alter table public.notification_contacts enable row level security;   -- no policies: service role only
revoke all on public.notification_contacts from anon, authenticated;

create or replace function public.set_notification_contact(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_updated timestamptz;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'bad_email';
  end if;

  select updated_at into v_updated from public.notification_contacts where user_id = auth.uid();
  if v_updated is not null and v_updated > now() - interval '10 minutes' then
    raise exception 'too_soon';   -- limits how many verification emails one account can trigger
  end if;

  insert into public.notification_contacts (user_id, email, consent_at, verify_token, verified_at, updated_at)
  values (auth.uid(), v_email, now(), gen_random_uuid(), null, now())
  on conflict (user_id) do update
    set email = excluded.email, consent_at = now(), verify_token = gen_random_uuid(),
        verified_at = null, updated_at = now();
end;
$$;

-- Never returns the tokens: those only go out by email.
create or replace function public.my_notification_contact()
returns table (email text, verified boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.email, c.verified_at is not null from public.notification_contacts c where c.user_id = auth.uid();
$$;

create or replace function public.clear_notification_contact()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notification_contacts where user_id = auth.uid();
$$;

-- The two links in the emails open in whatever browser the person uses, so they work from the token alone.
create or replace function public.confirm_notification_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_contacts set verified_at = coalesce(verified_at, now()) where verify_token = p_token;
  return found;
end;
$$;

create or replace function public.unsubscribe_contact(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notification_contacts where unsubscribe_token = p_token;
  return found;
end;
$$;

-- ---------------------------------------------------------------- who may call what
revoke all on function public.mark_notifications_read() from public, anon;
revoke all on function public.my_reports() from public, anon;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.set_notification_contact(text) from public, anon;
revoke all on function public.my_notification_contact() from public, anon;
revoke all on function public.clear_notification_contact() from public, anon;
revoke all on function public.confirm_notification_email(uuid) from public;
revoke all on function public.unsubscribe_contact(uuid) from public;

grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.my_reports() to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.set_notification_contact(text) to authenticated;
grant execute on function public.my_notification_contact() to authenticated;
grant execute on function public.clear_notification_contact() to authenticated;
grant execute on function public.confirm_notification_email(uuid) to anon, authenticated;
grant execute on function public.unsubscribe_contact(uuid) to anon, authenticated;
