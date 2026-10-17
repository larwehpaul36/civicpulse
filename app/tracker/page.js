'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';

export default function TrackerPage() {
  const [perf, setPerf] = useState(null);
  const [cats, setCats] = useState([]);
  const [counts, setCounts] = useState([0, 0, 0, 0]);

  useEffect(() => {
    (async () => {
      const [p, c, i] = await Promise.all([
        supabase.from('party_performance').select('*'),
        supabase.from('categories').select('id, name'),
        supabase.from('public_issues').select('status').limit(5000),
      ]);
      setPerf(p.data ?? []);
      setCats(c.data ?? []);
      const st = (i.data ?? []).map((x) => x.status);
      const n = (f) => st.filter(f).length;
      setCounts([st.length, n((x) => x !== 'reported'), n((x) => x === 'sent' || x === 'in_progress' || x === 'resolved'), n((x) => x === 'resolved')]);
    })();
  }, []);

  const groups = useMemo(() => {
    const by = {};
    (perf ?? []).forEach((r) => { (by[r.category_id] ||= []).push(r); });
    return cats
      .filter((c) => by[c.id])
      .map((c) => ({
        id: c.id,
        name: label(c.name),
        rows: by[c.id].sort((a, b) => (a.avg_days_to_resolve ?? 1e9) - (b.avg_days_to_resolve ?? 1e9)),
      }));
  }, [perf, cats]);

  return (
    <main className="wrap wide">
      <h1 className="page-title">{s.trackerTitle}</h1>
      <p>{s.trackerIntro}</p>
      <p className="hint">{s.totals(...counts)}</p>

      {perf === null && <p className="hint">{s.loading}</p>}
      {perf !== null && groups.length === 0 && <p>{s.trackerEmpty}</p>}

      {groups.map((g) => (
        <section key={g.id}>
          <h2>{g.name}</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>{s.party}</th><th>{s.resolvedCol}</th><th>{s.openCol}</th><th>{s.avgDays}</th></tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.party_id}>
                    <td>{r.name}</td>
                    <td>{r.resolved}</td>
                    <td>{r.open_cases}</td>
                    <td>{r.avg_days_to_resolve ?? s.noData}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
