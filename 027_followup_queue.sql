-- 027: the follow-up list for moderators. Run after 021 (office replies). Safe to run twice. No new tables.
-- It lists reports that were sent to an office and are still open, with what the moderator needs to decide whether to
-- send a reminder or escalate: when it was sent, whether the office has replied, the date the office promised, and when
-- we last reminded or escalated (read from the existing private contact log, contact_attempts).
-- The app decides who is "due" (7 days with no reply, 30 days to escalate, a missed promised date); this function only gathers the facts.
-- Moderators only. Contact details are private to moderators, like in admin_list_issues.

create or replace function public.admin_followup_queue()
returns table (
  id uuid, category_id uuid, other_label text, party_id uuid, party_name text,
  party_email text, party_phone text, party_whatsapp text,
  severity text, description text, status text, confirmation_count int,
  created_at timestamptz, sent_at timestamptz, lat double precision, lng double precision,
  replies_count int, last_reply_at timestamptz, expected_date date,
  reminders_count int, last_reminder_at timestamptz, last_escalation_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_moderator();
  return query
  select i.id, i.category_id, i.other_label, i.party_id, p.name, p.email, p.phone, p.whatsapp,
         i.severity::text, i.description, i.status::text, i.confirmation_count,
         i.created_at, i.sent_at, st_y(i.location::geometry), st_x(i.location::geometry),
         (select count(*)::int from office_replies r where r.issue_id = i.id and r.removed_at is null),
         (select max(r.created_at) from office_replies r where r.issue_id = i.id and r.removed_at is null),
         (select r.expected_date from office_replies r where r.issue_id = i.id and r.removed_at is null and r.kind = 'expected_date'
           order by r.created_at desc limit 1),
         (select count(*)::int from contact_attempts c where c.issue_id = i.id and c.note = 'Reminder sent'),
         (select max(c.created_at) from contact_attempts c where c.issue_id = i.id and c.note = 'Reminder sent'),
         (select max(c.created_at) from contact_attempts c where c.issue_id = i.id and c.note like 'Escalated%')
    from issues i
    join responsible_parties p on p.id = i.party_id
   where i.status::text in ('sent', 'in_progress')
     and i.duplicate_of is null
   order by i.sent_at nulls last, i.created_at
   limit 500;
end $$;

revoke all on function public.admin_followup_queue() from public, anon;
grant execute on function public.admin_followup_queue() to authenticated;

-- CHECK (expect: false, true):
--   select has_function_privilege('anon', 'admin_followup_queue()', 'execute'),
--          has_function_privilege('authenticated', 'admin_followup_queue()', 'execute');
