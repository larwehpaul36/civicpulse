-- 017: when someone signs in to an existing email account on a phone that already has reports of its own,
-- move those reports into the account they signed in to, instead of leaving them behind. Run after 016. Safe to run twice.
--
-- How it stays safe: before the sign-in link is sent, the phone (still signed in as its anonymous account) asks for a
-- one-time secret "ticket". The database keeps only a fingerprint of it. After the person opens the link and is signed in
-- to their real account, the phone hands the ticket over and the reports move. A ticket works once, for 24 hours, only
-- from an account that still has no email, and only into an account whose email is confirmed. Nobody else can use it,
-- because only that phone ever saw it.
--
-- What moves: reports, photos, confirmations, flags, "is it fixed?" answers, update notices, push alerts, the update-email address and
-- directory suggestions. Public numbers do not change, except that a confirmation the person already made with
-- their other account is not counted twice, and nobody is left "confirming" their own report.

create table if not exists merge_tickets (
  token_hash text primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table merge_tickets enable row level security;   -- no policies: only the functions below can touch it
revoke all on merge_tickets from anon, authenticated;

-- Step 1, on the old phone while it is still anonymous. Returns the secret ticket (shown once; only its fingerprint is kept).
create or replace function create_merge_ticket() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_ticket text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous is true) then
    raise exception 'not_anonymous';                       -- an account that already has an email has nothing to merge
  end if;
  delete from merge_tickets where from_user = v_uid;      -- one live ticket per account
  v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into merge_tickets (token_hash, from_user, expires_at)
    values (encode(sha256(convert_to(v_ticket, 'UTF8')), 'hex'), v_uid, now() + interval '24 hours');
  return v_ticket;
end $$;

-- Step 2, after signing in to the real account. Returns {"moved": number of reports}.
create or replace function claim_merge_ticket(p_ticket text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_to   uuid := auth.uid();
  v_hash text := encode(sha256(convert_to(coalesce(p_ticket, ''), 'UTF8')), 'hex');
  v_from uuid;
  v_moved int := 0;
begin
  if v_to is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_to and u.email_confirmed_at is not null) then
    raise exception 'not_permanent';                       -- only into an account whose email is confirmed
  end if;

  select t.from_user into v_from from merge_tickets t
   where t.token_hash = v_hash and t.used_at is null and t.expires_at > now() for update;
  if v_from is null then raise exception 'ticket_invalid'; end if;

  if v_from = v_to then                                    -- opened where they were already signed in: nothing to move
    update merge_tickets set used_at = now() where token_hash = v_hash;
    return jsonb_build_object('moved', 0);
  end if;
  if not exists (select 1 from auth.users u where u.id = v_from and u.is_anonymous is true) then
    raise exception 'ticket_invalid';                      -- the old account is no longer a plain anonymous one
  end if;

  update issues set reporter_id = v_to where reporter_id = v_from;
  get diagnostics v_moved = row_count;
  update issue_photos set uploaded_by = v_to where uploaded_by = v_from;

  -- Confirmations: never count one person twice, and never leave someone confirming their own report.
  with gone as (
    delete from confirmations c
     where (c.user_id = v_from and (exists (select 1 from confirmations b where b.issue_id = c.issue_id and b.user_id = v_to)
                                    or exists (select 1 from issues i where i.id = c.issue_id and i.reporter_id = v_to)))
        or (c.user_id = v_to and exists (select 1 from issues i where i.id = c.issue_id and i.reporter_id = v_to))
    returning c.issue_id, coalesce(c.counts, true) as counted
  )
  update issues i set confirmation_count = greatest(0, i.confirmation_count - g.n)
    from (select issue_id, count(*) filter (where counted) as n from gone group by issue_id) g
   where i.id = g.issue_id and g.n > 0;
  update confirmations set user_id = v_to where user_id = v_from;

  delete from flags f where f.user_id = v_from and exists (select 1 from flags b where b.issue_id = f.issue_id and b.user_id = v_to);
  update flags set user_id = v_to where user_id = v_from;

  if to_regclass('public.fix_checks') is not null then       -- "Is it fixed?" answers (019), when that migration has been run
    execute 'delete from fix_checks f where f.user_id = $1 and exists (select 1 from fix_checks b where b.issue_id = f.issue_id and b.cycle = f.cycle and b.user_id = $2)' using v_from, v_to;
    execute 'update fix_checks set user_id = $2 where user_id = $1' using v_from, v_to;
  end if;
  update notifications set user_id = v_to where user_id = v_from;
  update push_subscriptions set user_id = v_to where user_id = v_from;
  delete from notification_contacts where user_id = v_from and exists (select 1 from notification_contacts where user_id = v_to);
  update notification_contacts set user_id = v_to where user_id = v_from;
  update directory_suggestions set suggested_by = v_to where suggested_by = v_from;

  update merge_tickets set used_at = now() where token_hash = v_hash;
  return jsonb_build_object('moved', v_moved);
end $$;

revoke all on function create_merge_ticket() from public, anon, authenticated;
revoke all on function claim_merge_ticket(text) from public, anon, authenticated;
grant execute on function create_merge_ticket() to authenticated;   -- anonymous sign-ins use this role too
grant execute on function claim_merge_ticket(text) to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Only signed-in visitors can call the two functions (expect: anon_can f, signed_in_can t for both):
select has_function_privilege('anon', 'create_merge_ticket()', 'execute') as anon_can,
       has_function_privilege('authenticated', 'create_merge_ticket()', 'execute') as signed_in_can,
       has_function_privilege('anon', 'claim_merge_ticket(text)', 'execute') as anon_can_claim,
       has_function_privilege('authenticated', 'claim_merge_ticket(text)', 'execute') as signed_in_can_claim;
-- B) Nobody can read the ticket table through the API (expect: f, f):
select has_table_privilege('anon', 'merge_tickets', 'select') as anon_reads, has_table_privilege('authenticated', 'merge_tickets', 'select') as signed_in_reads;
