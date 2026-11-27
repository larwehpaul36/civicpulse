'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { describeActivity, groupActivity } from '@/lib/moderatorTools';

const T = s.admin.activity;
const when = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The record of who did what. Read-only: it is written by the database and nobody can edit it from the app.
export default function AdminActivity({ parties, categoryNames, myId }) {
  const [rows, setRows] = useState(null);       // null = loading
  const [missing, setMissing] = useState(false);
  const [limit, setLimit] = useState(100);
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_activity', { p_limit: limit });
    if (error) { setMissing(true); setRows([]); return; }     // 028 not run yet
    setMissing(false); setRows(data ?? []);
  }, [limit]);
  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => ({ parties: Object.fromEntries(parties.map((p) => [p.id, p.name])), categories: categoryNames }), [parties, categoryNames]);
  const groups = useMemo(() => groupActivity((rows ?? []).filter((r) => !mineOnly || r.moderator_id === myId)), [rows, mineOnly, myId]);

  return (
    <section>
      <h2>{T.title}</h2>
      <p className="hint">{T.intro}</p>
      <p className="cta-row">
        <button type="button" className="secondary" onClick={load}>{T.refresh}</button>
        <label className="inline-check"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> {T.filterMine}</label>
      </p>
      {rows === null && <p className="hint">{T.loading}</p>}
      {missing && <p className="warn">{T.missing}</p>}
      {rows !== null && !missing && groups.length === 0 && <p>{T.none}</p>}
      <ul className="activity">
        {groups.map((g) => (
          <li key={g.id}>
            <p><strong>{describeActivity(g, T, names)}</strong>{g.count > 1 && <> <span className="chip">{T.bulkTag}</span></>}</p>
            <p className="hint">
              {g.moderator_id === myId ? T.you : g.moderator_email ?? '—'} · {when(g.created_at)}
              {g.count === 1 && g.issue_id && <> · <a href={`/issues/${g.issue_id}`} target="_blank" rel="noopener noreferrer">{T.openReport}</a></>}
            </p>
          </li>
        ))}
      </ul>
      {rows && rows.length >= limit && limit < 300 && <button type="button" className="secondary" onClick={() => setLimit(300)}>{T.more}</button>}
    </section>
  );
}
