'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import ShareButton from '@/components/ShareButton';
import { strings as s } from '@/lib/strings';
import { lastFullMonth, monthlyReport, shiftMonth } from '@/lib/monthly';

const M = s.monthly;
const monthName = ({ year, month }) => new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Board({ title, note, items, line, names }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {note && <p className="hint">{note}</p>}
      {items.length === 0 ? <p>{M.none}</p> : (
        <ol>{items.map((o) => <li key={o.id}><strong>{names[o.id] ?? '—'}</strong>: {line(o)}</li>)}</ol>
      )}
    </section>
  );
}

export default function MonthlyPage() {
  const now = useMemo(() => Date.now(), []);
  const latest = useMemo(() => lastFullMonth(now), [now]);
  const [month, setMonth] = useState(latest);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [issues, parties, fix] = await Promise.all([
          fetchAll((a, b) => supabase.from('public_issues').select('id, status, party_id, created_at, sent_at, resolved_at').order('id').range(a, b)),
          fetchAll((a, b) => supabase.from('responsible_parties').select('id, name').order('id').range(a, b)),
          fetchAll((a, b) => supabase.from('public_fix_checks').select('issue_id, reopen_count').gt('reopen_count', 0).order('issue_id').range(a, b)).catch(() => []), // before 019
        ]);
        const reopen = new Map(fix.map((x) => [x.issue_id, x.reopen_count]));
        setData({ rows: issues.map((r) => ({ ...r, reopen_count: reopen.get(r.id) ?? 0 })), names: Object.fromEntries(parties.map((p) => [p.id, p.name])) });
      } catch (err) { console.error(err); setData({ rows: [], names: {} }); }
    })();
  }, []);

  const report = useMemo(() => (data ? monthlyReport(data.rows, month) : null), [data, month]);
  const isLatest = month.year === latest.year && month.month === latest.month;

  return (
    <main className="wrap wide">
      <h1 className="page-title">{M.title}: {monthName(month)}</h1>
      <p>{M.intro}</p>
      <div className="tabs" role="group" aria-label={M.title}>
        <button type="button" className="tab" onClick={() => setMonth(shiftMonth(month, -1))}>← {M.prev}</button>
        <button type="button" className="tab" disabled={isLatest} onClick={() => setMonth(shiftMonth(month, 1))}>{M.next} →</button>
      </div>

      {report === null && <p className="hint">{s.loading}</p>}
      {report !== null && (
        <>
          <div className="kpis">
            {[[report.headline.filed, M.filed], [report.headline.sent, M.sent], [report.headline.resolved, M.resolved], [report.headline.medianDays === null ? '—' : M.days(report.headline.medianDays), M.median]]
              .map(([v, k]) => <div key={k} className="tile"><b>{v}</b><span>{k}</span></div>)}
          </div>
          <ShareButton title={M.shareTitle(monthName(month))} text={M.shareText(monthName(month), report.headline)} />
          <div className="pcards">
            <Board title={M.slowestTitle} note={M.slowestNote} items={report.slowest} line={M.slowestLine} names={data.names} />
            <Board title={M.improvedTitle} note={M.improvedNote(report.minFixes)} items={report.improved} line={M.improvedLine} names={data.names} />
            <Board title={M.fixesTitle} items={report.mostFixes} line={M.fixesLine} names={data.names} />
          </div>
          <details className="how-it-works">
            <summary>{M.limitsTitle}</summary>
            <ul>{M.limits.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
          <p><Link href="/tracker">{s.navTracker}</Link> · <Link href="/data">{s.tracker2.dataLink}</Link></p>
        </>
      )}
    </main>
  );
}
