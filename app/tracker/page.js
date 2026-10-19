'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { summarize, partyStats, sortParties, weeklyTrend } from '@/lib/trackerStats';

const T = s.tracker2;
const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function TrendChart({ trend }) {
  const W = 640, H = 200, L = 34, R = 12, TOP = 14, B = 28;
  const max = Math.max(1, ...trend.flatMap((w) => [w.filed, w.resolved]));
  const x = (i) => L + (i * (W - L - R)) / (trend.length - 1);
  const y = (v) => TOP + (H - TOP - B) * (1 - v / max);
  const pts = (k) => trend.map((w, i) => `${x(i)},${y(w[k])}`).join(' ');
  const filed = trend.reduce((n, w) => n + w.filed, 0), resolved = trend.reduce((n, w) => n + w.resolved, 0);
  return (
    <div className="chart">
      <div className="legend"><span><i style={{ background: '#c99700' }} />{T.filed}</span><span><i style={{ background: 'var(--green)' }} />{T.resolved}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${T.chartTitle}: ${filed} ${T.filed.toLowerCase()}, ${resolved} ${T.resolved.toLowerCase()}`}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line)" /><line x1={L} x2={W - R} y1={y(max)} y2={y(max)} stroke="var(--line)" strokeDasharray="3 4" />
        <text x={L - 6} y={y(0) + 4} textAnchor="end">0</text><text x={L - 6} y={y(max) + 4} textAnchor="end">{max}</text>
        <text x={L} y={H - 8}>{fmtDate(trend[0].start)}</text><text x={W - R} y={H - 8} textAnchor="end">{fmtDate(trend[trend.length - 1].start)}</text>
        <polygon className="f" points={`${L},${y(0)} ${pts('filed')} ${W - R},${y(0)}`} />
        <polyline className="fl" points={pts('filed')} /><polyline className="rl" points={pts('resolved')} />
      </svg>
      <details><summary>{T.table}</summary>
        <div className="table-scroll"><table>
          <thead><tr><th>{T.week}</th><th>{T.filed}</th><th>{T.resolved}</th></tr></thead>
          <tbody>{trend.map((w) => <tr key={w.start}><td>{fmtDate(w.start)}</td><td>{w.filed}</td><td>{w.resolved}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}

function Spark({ data }) {
  const W = 84, H = 26, m = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i * (W - 4)) / (data.length - 1) + 2},${H - 3 - (v / m) * (H - 8)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={T.fixesPerWeek}><polyline points={pts} /></svg>;
}

function PartyCard({ p, name }) {
  return (
    <article className="pcard">
      <header>
        <h3>{name}</h3>
        {p.early && <span className="chip">{T.early(p.sent)}</span>}
      </header>
      <div className="pmetrics">
        <div className="m"><b>{p.median === null ? '—' : T.days(p.median)}</b><span>{p.median === null ? T.none : T.median}</span></div>
        <div className="m"><b>{p.resolved}/{p.sent}</b><span>{T.rate} ({p.rate}%)</span></div>
        <div className="m"><b>{p.open}</b><span>{T.open}</span></div>
        <div className="m"><b>{p.oldestOpen === null ? '—' : T.days(p.oldestOpen)}</b><span>{T.oldest}</span></div>
      </div>
      <div className="rate" aria-hidden="true"><i style={{ width: `${p.rate}%` }} /></div>
      <div className="sparkrow"><Spark data={p.spark} /><span className="hint">{T.fixesPerWeek}</span></div>
    </article>
  );
}

export default function TrackerPage() {
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('fastest');
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    (async () => {
      const [i, p, c] = await Promise.all([
        supabase.from('public_issues').select('id, status, party_id, category_id, created_at, sent_at, resolved_at').limit(5000),
        supabase.from('responsible_parties').select('id, name'),
        supabase.from('categories').select('id, name'),
      ]);
      setData({ rows: i.data ?? [], names: Object.fromEntries((p.data ?? []).map((x) => [x.id, x.name])), cats: c.data ?? [] });
    })();
  }, []);

  const rows = useMemo(() => (data ? data.rows.filter((r) => cat === 'all' || r.category_id === cat) : []), [data, cat]);
  const kpi = useMemo(() => summarize(rows), [rows]);
  const parties = useMemo(() => sortParties(partyStats(rows, now), sort), [rows, sort, now]);
  const trend = useMemo(() => weeklyTrend(rows, now, 12), [rows, now]);
  const usedCats = data ? data.cats.filter((c) => data.rows.some((r) => r.category_id === c.id)) : [];
  const tiles = [kpi.filed, kpi.sent, kpi.resolved, kpi.median === null ? '—' : T.days(kpi.median)];

  return (
    <main className="wrap wide">
      <h1 className="page-title">{s.trackerTitle}</h1>
      <p>{T.intro}</p>

      {data === null && <p className="hint">{s.loading}</p>}
      {data !== null && (
        <>
          {usedCats.length > 1 && (
            <div className="tabs" role="group" aria-label={T.all}>
              <button type="button" className={`tab${cat === 'all' ? ' on' : ''}`} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>{T.all}</button>
              {usedCats.map((c) => (
                <button key={c.id} type="button" className={`tab${cat === c.id ? ' on' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{label(c.name)}</button>
              ))}
            </div>
          )}

          <div className="kpis">
            {T.kpis.map((k, n) => <div key={k} className="tile"><b>{tiles[n]}</b><span>{k}</span></div>)}
          </div>

          <section className="card chartcard">
            <h2>{T.chartTitle}</h2>
            <TrendChart trend={trend} />
          </section>

          <h2>{s.party}</h2>
          {parties.length === 0 ? <p>{s.trackerEmpty}</p> : (
            <>
              <div className="tabs" role="group" aria-label="Sort">
                {Object.entries(T.sorts).map(([k, v]) => (
                  <button key={k} type="button" className={`tab${sort === k ? ' on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{v}</button>
                ))}
              </div>
              <div className="pcards">{parties.map((p) => <PartyCard key={p.id} p={p} name={data.names[p.id] ?? '—'} />)}</div>
            </>
          )}

          <details className="how-it-works">
            <summary>{T.howTitle}</summary>
            <ul>{T.how.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        </>
      )}
    </main>
  );
}
