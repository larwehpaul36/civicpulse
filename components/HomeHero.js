'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { home as h } from '@/lib/homeStrings';

const S = 520, PAD = 70;

// Fit the real report coordinates into the square map card.
function project(rows) {
  const pts = rows.filter((r) => r.lat != null && r.lng != null);
  if (!pts.length) return [];
  const la = pts.map((p) => p.lat), lo = pts.map((p) => p.lng);
  const spanLa = Math.max(Math.max(...la) - Math.min(...la), 0.06);
  const spanLo = Math.max(Math.max(...lo) - Math.min(...lo), 0.06);
  const cLa = (Math.max(...la) + Math.min(...la)) / 2, cLo = (Math.max(...lo) + Math.min(...lo)) / 2;
  const k = Math.min((S - 2 * PAD) / spanLo, (S - 2 * PAD) / spanLa);
  return pts.slice(0, 60).map((p) => ({ id: p.id, x: S / 2 + (p.lng - cLo) * k, y: S / 2 - (p.lat - cLa) * k, done: p.status === 'resolved' }));
}
function median(a) {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y), m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2);
}

export default function HomeHero() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.from('public_issues').select('id, status, lat, lng, days_open').order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => setRows(data ?? []));
  }, []);

  const total = rows?.length ?? 0;
  const resolved = (rows ?? []).filter((r) => r.status === 'resolved');
  const confirmed = (rows ?? []).filter((r) => r.status !== 'reported').length;
  const med = median(resolved.map((r) => r.days_open));
  const dash = '—';
  const nums = rows === null ? [dash, dash, dash, dash]
    : [total, total ? `${Math.round((confirmed / total) * 100)}%` : '0%', resolved.length, med === null ? dash : `${med} d`];
  const pins = project(rows ?? []);

  return (
    <>
      <section className="hx">
        <div>
          <span className="hx-live reveal"><i />{h.live}</span>
          <h1 className="reveal" style={{ '--i': 1 }}>{h.titleA} <em>{h.titleB}</em></h1>
          <p className="hx-sub reveal" style={{ '--i': 2 }}>{h.sub}</p>
          <div className="cta-row reveal" style={{ '--i': 3 }}>
            <a className="cta" href="#report">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              {h.cta}
            </a>
            <Link className="cta ghost" href="/tracker">{h.ctaTracker} →</Link>
          </div>
          <div className="hx-trust reveal" style={{ '--i': 4 }}>{h.trust.map((x) => <span key={x}>✓ {x}</span>)}</div>
        </div>

        <div className="mapcard reveal" style={{ '--i': 2 }} role="img" aria-label={rows ? h.mapNote(total) : h.mapTag}>
          <svg viewBox={`0 0 ${S} ${S}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs><pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#1e3a2c" /></pattern></defs>
            <rect width={S} height={S} fill="url(#dots)" />
            <path className="road" d="M-10 380 C120 330 180 420 300 340 S470 250 540 280" />
            <path className="road" d="M90 -10 C130 120 90 200 190 290 S260 460 240 540" />
            <path className="road" d="M-10 150 C140 170 250 90 540 130" />
            {pins.map((p, i) => (
              <g key={p.id} fill={p.done ? '#2fbf7a' : '#f2b705'}>
                <circle cx={p.x} cy={p.y} r="7" />
                {!p.done && <circle className="rip" cx={p.x} cy={p.y} r="7" style={{ animationDelay: `${(i % 5) * 0.5}s` }} />}
              </g>
            ))}
          </svg>
          <span className="maptag">{h.mapTag}</span>
          {rows !== null && <div className="mapnote">{total ? h.mapNote(total) : h.mapEmpty}</div>}
        </div>
      </section>

      <div className="statband"><div className="statband-in">
        {h.stats.map((l, i) => (<div key={l}><div className="stat-n">{nums[i]}</div><div className="stat-l">{l}</div></div>))}
      </div></div>
    </>
  );
}
