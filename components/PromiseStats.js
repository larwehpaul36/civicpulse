'use client';
// "Promises kept": for each office, how many expected fix dates were met. Used on /admin, and on the public tracker when switched on.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { loadDateReplies, promiseStats, MIN_DECIDED } from '@/lib/promises';

const P = s.promises;

export default function PromiseStats({ rows, names }) {
  const [replies, setReplies] = useState(null);
  useEffect(() => { let dead = false; loadDateReplies(supabase).then((r) => { if (!dead) setReplies(r); }); return () => { dead = true; }; }, []);
  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => (replies ? promiseStats(rows, replies, today) : []), [rows, replies, today]);

  if (replies === null) return <p className="hint">{s.loading}</p>;
  if (stats.length === 0) return <p className="hint">{P.none}</p>;
  return (
    <section aria-label={P.title}>
      <h2>{P.title}</h2>
      <p>{P.intro}</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>{P.office}</th><th>{P.made}</th><th>{P.kept}</th><th>{P.late}</th><th>{P.overdue}</th><th>{P.moved}</th><th>{P.percent}</th></tr></thead>
          <tbody>
            {stats.map((p) => (
              <tr key={p.id}>
                <td>{names[p.id] ?? '—'}</td><td>{p.made}</td><td>{p.kept}</td><td>{p.late}</td>
                <td>{p.overdue > 0 ? <strong>{p.overdue}</strong> : 0}</td><td>{p.moved}</td>
                <td>{p.keptPercent === null ? <span className="hint">{P.tooFew(p.decided, MIN_DECIDED)}</span> : `${p.keptPercent}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="how-it-works"><summary>{P.howTitle}</summary><ul>{P.how.map((t) => <li key={t}>{t}</li>)}</ul></details>
    </section>
  );
}
