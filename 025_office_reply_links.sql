-- 025: one-tap reply links for offices. Run after 021 and 022. Safe to run twice.
-- A moderator sends a case to an office by WhatsApp or email (a prepared message). This adds a private link to that message.
-- The officer opens it, picks "a reply", "an expected fix date" or "not our job", and sends. No sign-in, no app.
-- The reply is public at once, labelled "sent through a reply link" (not "verified"), and followers are notified (trigger from 022).
--
-- Safety, in plain words:
--   * The link carries a long random secret. Only its SHA-256 hash is stored, so a database leak cannot reveal live links.
--   * A link works for one report only, expires (30 days by default, 60 at most) and can be revoked by a moderator.
--   * A moderator keeps at most the 5 newest links per report; older ones stop working.
--   * Replies through links are limited to 5 per report per day.
--   * A wrong, expired or revoked link all look the same to the visitor ("link_invalid"), so nobody can probe which exist.
--   * Moderators can still hide any reply (admin_hide_office_reply from 021). Hidden replies leave the public page.
--   * Anyone holding the link can reply: it is a shared secret, not proof of who the person is. That is why the page says so.

create table if not exists office_reply_links (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references issues(id) on delete cascade,
  party_id    uuid references responsible_parties(id) on delete set null,
  token_hash  text not null unique,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index if not exists office_reply_links_issue_idx on office_reply_links (issue_id, created_at);
alter table office_reply_links enable row level security;     -- no policies: every read and write goes through the functions below
revoke all on office_reply_links from anon, authenticated;

-- Where a public reply came from. Existing rows stay 'moderator'.
alter table office_replies add column if not exists source text not null default 'moderator';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_replies_source_check') then
    alter table office_replies add constraint office_replies_source_check check (source in ('moderator', 'link'));
  end if;
end $$;
grant select (source) on office_replies to anon, authenticated;

create or replace function public.reply_token_hash(p text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;
revoke all on function public.reply_token_hash(text) from public, anon, authenticated;

-- Moderator: make a link for a report. Returns the secret ONCE; it cannot be read back later.
create or replace function public.admin_make_reply_link(p_issue uuid, p_days int default 30)
returns text
language plpgsql security definer set search_path = public as $$
declare v_party uuid; v_token text;
begin
  perform assert_moderator();
  if p_days is null or p_days < 1 or p_days > 60 then raise exception 'bad_days'; end if;
  select party_id into v_party from issues where id = p_issue and status <> 'rejected';
  if not found then raise exception 'issue_not_found'; end if;
  if v_party is null then raise exception 'no_party'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- 64 hex characters, about 244 random bits
  insert into office_reply_links (issue_id, party_id, token_hash, created_by, expires_at)
  values (p_issue, v_party, reply_token_hash(v_token), auth.uid(), now() + make_interval(days => p_days));
  -- keep only the 5 newest live links for this report
  update office_reply_links set revoked_at = now()
   where issue_id = p_issue and revoked_at is null
     and id not in (select id from office_reply_links where issue_id = p_issue and revoked_at is null order by created_at desc, id desc limit 5);
  return v_token;
end $$;

-- Moderator: switch off every link for a report (a link was forwarded to the wrong person, say). Returns how many were live.
create or replace function public.admin_revoke_reply_links(p_issue uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform assert_moderator();
  update office_reply_links set revoked_at = now() where issue_id = p_issue and revoked_at is null and expires_at > now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Visitor with a link: what the page may show. Only what the public report page already shows. No rows = bad link.
create or replace function public.office_link_info(p_token text)
returns table (issue_id uuid, party_name text, category_id uuid, status text, description text,
               created_at timestamptz, sent_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, p.name, i.category_id, i.status::text, i.description, i.created_at, i.sent_at, l.expires_at
    from office_reply_links l
    join issues i on i.id = l.issue_id
    left join responsible_parties p on p.id = l.party_id
   where l.token_hash = reply_token_hash(p_token)
     and l.revoked_at is null and l.expires_at > now()
     and i.status <> 'rejected'
$$;

-- Visitor with a link: record a public reply. Same rules as a moderator's (021), plus the link checks and a daily limit.
create or replace function public.office_reply_via_link(
  p_token text, p_kind text, p_body text default null, p_expected date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_issue uuid; v_party uuid; v_id uuid; v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  select l.issue_id, l.party_id into v_issue, v_party
    from office_reply_links l join issues i on i.id = l.issue_id
   where l.token_hash = reply_token_hash(p_token)
     and l.revoked_at is null and l.expires_at > now() and i.status <> 'rejected';
  if not found then raise exception 'link_invalid'; end if;
  if v_party is null then raise exception 'link_invalid'; end if;
  if p_kind is null or p_kind not in ('reply', 'expected_date', 'not_ours') then raise exception 'bad_kind'; end if;
  if p_kind <> 'expected_date' and v_body is null then raise exception 'text_required'; end if;
  if v_body is not null and char_length(v_body) > 500 then raise exception 'too_long'; end if;
  if p_kind = 'expected_date' then
    if p_expected is null then raise exception 'date_required'; end if;
    if p_expected < current_date or p_expected > current_date + 365 then raise exception 'bad_date'; end if;
  else
    p_expected := null;
  end if;
  if (select count(*) from office_replies where issue_id = v_issue and source = 'link' and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited';
  end if;
  insert into office_replies (issue_id, party_id, kind, body, expected_date, source)
  values (v_issue, v_party, p_kind, v_body, p_expected, 'link')
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.admin_make_reply_link(uuid, int) from public, anon;
revoke all on function public.admin_revoke_reply_links(uuid) from public, anon;
grant execute on function public.admin_make_reply_link(uuid, int) to authenticated;
grant execute on function public.admin_revoke_reply_links(uuid) to authenticated;
revoke all on function public.office_link_info(text) from public;
revoke all on function public.office_reply_via_link(text, text, text, date) from public;
grant execute on function public.office_link_info(text) to anon, authenticated;
grant execute on function public.office_reply_via_link(text, text, text, date) to anon, authenticated;

-- CHECK (expect: permission denied): set role anon; select token_hash from office_reply_links limit 1; reset role;
-- CHECK (expect: no rows for a made-up link): set role anon; select * from office_link_info('nonsense'); reset role;
