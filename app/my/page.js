'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadMine, markAllRead } from '@/lib/notifications';
import { useOutbox } from '@/lib/useOutbox';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { categoryTitle } from '@/lib/categoryTitle';
import NotificationSettings from '@/components/NotificationSettings';

const when = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function MyReportsPage() {
  const { items } = useOutbox();
  const [data, setData] = useState({ loading: true, failed: false, reports: [], updates: [], unread: new Set() });
  const [cats, setCats] = useState([]);
  const waiting = items.filter((i) => i.status === 'pending');

  // Reload when a saved report finishes sending, so it moves from "waiting" to "sent".
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mine, c] = await Promise.all([loadMine(), supabase.from('categories').select('id, name')]);
        if (!alive) return;
        const unread = new Set(mine.updates.filter((u) => !u.read_at).map((u) => u.id));
        setData({ loading: false, failed: false, reports: mine.reports, updates: mine.updates, unread });
        setCats(c.data ?? []);
        if (unread.size) await markAllRead(); // the "New" marks stay for this visit, the nav badge clears
      } catch (e) {
        console.error(e);
        if (alive) setData((d) => ({ ...d, loading: false, failed: true }));
      }
    })();
    return () => { alive = false; };
  }, [waiting.length]);

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, label(c.name)])), [cats]);
  const freshIssues = useMemo(
    () => new Set(data.updates.filter((u) => data.unread.has(u.id)).map((u) => u.issue_id)),
    [data]
  );
  const reportsById = useMemo(() => Object.fromEntries(data.reports.map((r) => [r.id, r])), [data.reports]);

  return (
    <main className="wrap">
      <h1 className="page-title">{s.mine.title}</h1>
      <p className="hint">{s.mine.intro}</p>

      {data.failed && <p className="warn">{s.mine.loadFailed}</p>}

      {waiting.length > 0 && (
        <>
          <h2>{s.mine.waitingTitle}</h2>
          <ul className="cards">
            {waiting.map((i) => (
              <li key={i.id} className="warn">
                <strong>{s.mine.savedOn(new Date(i.createdAt).toLocaleString())}</strong>
                {i.description && <p>{i.description.slice(0, 100)}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{s.mine.reportsTitle}</h2>
      {data.loading && <p className="hint">{s.loading}</p>}
      {!data.loading && !data.failed && data.reports.length === 0 && <p className="hint">{s.mine.noReports}</p>}
      <ul className="cards">
        {data.reports.map((r) => (
          <li key={r.id}>
            <Link href={`/issues/${r.id}`}>
              <span>
                <span className="chip">{s.statusLabels[r.status] ?? r.status}</span>
                {freshIssues.has(r.id) && <span className="badge">{s.mine.updated}</span>}
              </span>
              <strong>{categoryTitle(catName[r.category_id] ?? '', r.other_label)}</strong>
              <span className="hint">{s.daysOpen(r.days_open)}</span>
              {r.description && <span>{r.description.slice(0, 100)}</span>}
            </Link>
          </li>
        ))}
      </ul>

      <h2>{s.mine.updatesTitle}</h2>
      {!data.loading && !data.failed && data.updates.length === 0 && <p className="hint">{s.mine.noUpdates}</p>}
      <ul className="cards">
        {data.updates.map((u) => (
          <li key={u.id}>
            <Link href={`/issues/${u.issue_id}`}>
              <span>
                <strong>{catName[reportsById[u.issue_id]?.category_id] ?? s.mine.title}</strong>
                {data.unread.has(u.id) && <span className="badge">{s.mine.fresh}</span>}
              </span>
              <span>{s.mine.updateLine(s.statusLabels[u.to_status] ?? u.to_status)}</span>
              <span className="hint">{when(u.created_at)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <NotificationSettings />
    </main>
  );
}
