-- 024: make the account merge (017) work with phone numbers too. Run after 017. Safe to run twice.
-- It does NOT switch the phone rules on (that is still 011b) and changes nothing for residents who never verified a phone.
--
-- What was wrong (HANDOVER, "gap 1"):
--   1. A phone that had verified a number and then signed in to an email account brought its reports along, but the verified
--      number stayed behind on the old account. The email account stayed "unverified", and verifying the same number again could
--      be refused as already used.
--   2. A phone whose number already belonged to another account was signed in to that account by the phone check, and this
--      phone's own reports were left behind: there was no merge step on that path.
--   3. Supabase may switch an account's is_anonymous flag to false once a phone is linked, and the merge only accepted accounts
--      that were still flagged anonymous, so such a phone could not make a ticket at all.
--
-- What changes (everything else in 017 stays exactly as it was):
--   * "Old account" now means "an account with no confirmed email", instead of relying on the is_anonymous flag.
--     A plain anonymous account has no email, so everything that worked before still works.
--   * "New account" may be proved by a confirmed email (as before) OR a confirmed phone number (the phone-path sign-in).
--   * If the old account has a confirmed phone number and the new account has none, the number moves with the reports
--     (cleared from the old account first, because a number can belong to only one account).
--   * If the new account already has its own confirmed number, it keeps it and the old number is left where it is.
-- The ticket rules are unchanged: a secret only that phone saw, kept as a fingerprint, used once, within 24 hours.

create or replace function create_merge_ticket() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_ticket text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is null) then
    raise exception 'not_anonymous';                       -- an account with a confirmed email has nothing to merge (same code as before)
  end if;
  delete from merge_tickets where from_user = v_uid;      -- one live ticket per account
  v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into merge_tickets (token_hash, from_user, expires_at)
    values (encode(sha256(convert_to(v_ticket, 'UTF8')), 'hex'), v_uid, now() + interval '24 hours');
  return v_ticket;
end $$;

create or replace function claim_merge_ticket(p_ticket text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_to   uuid := auth.uid();
  v_hash text := encode(sha256(convert_to(coalesce(p_ticket, ''), 'UTF8')), 'hex');
  v_from uuid;
  v_moved int := 0;
  v_phone text;
  v_phone_at timestamptz;
begin
  if v_to is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from auth.users u where u.id = v_to and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then
    raise exception 'not_permanent';                       -- only into an account whose email OR phone number is confirmed
  end if;

  select t.from_user into v_from from merge_tickets t
   where t.token_hash = v_hash and t.used_at is null and t.expires_at > now() for update;
  if v_from is null then raise exception 'ticket_invalid'; end if;

  if v_from = v_to then                                    -- opened where they were already signed in: nothing to move
    update merge_tickets set used_at = now() where token_hash = v_hash;
    return jsonb_build_object('moved', 0);
  end if;
  if not exists (select 1 from auth.users u where u.id = v_from and u.email_confirmed_at is null) then
    raise exception 'ticket_invalid';                      -- the old account has since gained a confirmed email
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

  -- NEW in 024: the verified phone number travels with the reports, unless the new account already has its own.
  select u.phone, u.phone_confirmed_at into v_phone, v_phone_at from auth.users u where u.id = v_from;
  if v_phone is not null and v_phone <> '' and v_phone_at is not null
     and exists (select 1 from auth.users u where u.id = v_to and u.phone_confirmed_at is null) then
    update auth.users set phone = null, phone_confirmed_at = null where id = v_from;   -- a number belongs to one account only
    update auth.users set phone = v_phone, phone_confirmed_at = v_phone_at where id = v_to;
  end if;

  update merge_tickets set used_at = now() where token_hash = v_hash;
  return jsonb_build_object('moved', v_moved);
end $$;

revoke all on function create_merge_ticket() from public, anon, authenticated;
revoke all on function claim_merge_ticket(text) from public, anon, authenticated;
grant execute on function create_merge_ticket() to authenticated;
grant execute on function claim_merge_ticket(text) to authenticated;

-- ---------------------------------------------------------------------------
-- CHECKS. Each should run without an error.
-- A) Same permissions as 017 (expect: f, t, f, t):
select has_function_privilege('anon', 'create_merge_ticket()', 'execute') as anon_can,
       has_function_privilege('authenticated', 'create_merge_ticket()', 'execute') as signed_in_can,
       has_function_privilege('anon', 'claim_merge_ticket(text)', 'execute') as anon_can_claim,
       has_function_privilege('authenticated', 'claim_merge_ticket(text)', 'execute') as signed_in_can_claim;
-- B) The new rule is in place (expect: true for both):
select pg_get_functiondef('create_merge_ticket()'::regprocedure) like '%email_confirmed_at is null%' as old_rule_is_no_email,
       pg_get_functiondef('claim_merge_ticket(text)'::regprocedure) like '%phone_confirmed_at is not null%' as phone_target_allowed;
