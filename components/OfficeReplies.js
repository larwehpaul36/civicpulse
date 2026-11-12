'use client';
// Public part of "right of reply": what the responsible office told us about this report.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { loadReplies, latestExpectedDate, isOverdue } from '@/lib/officeReplies';

const dateText = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const todayText = () => new Date().toISOString().slice(0, 10);

export default function OfficeReplies({ issueId, status, partyName }) {
  const [replies, setReplies] = useState(null);
  const t = s.replies;
  useEffect(() => { let dead = false; loadReplies(supabase, issueId).then((r) => { if (!dead) setReplies(r); }); return () => { dead = true; }; }, [issueId]);

  if (replies === null) return null;                    // loading: show nothing rather than flicker
  if (replies.length === 0) return null;                // nothing to show; the page stays as it was
  const late = isOverdue(latestExpectedDate(replies), status, todayText());
  return (
    <section aria-label={t.title}>
      <h2>{t.title}{partyName ? `: ${partyName}` : ''}</h2>
      <ul className="timeline">
        {replies.map((r) => (
          <li key={r.id}>
            {dateText(r.created_at)}: {' '}
            {r.kind === 'expected_date' && <strong>{t.expected(dateText(r.expected_date))}</strong>}
            {r.kind === 'not_ours' && <><strong>{t.notOurs}.</strong> </>}
            {r.body && <span>“{r.body}”</span>}
          </li>
        ))}
      </ul>
      {late && <p role="status"><strong>{t.overdue}</strong></p>}
      <p className="hint">{t.relayed}. {t.about}</p>
    </section>
  );
}
