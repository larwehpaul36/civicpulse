'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mySuggestions } from '@/lib/directoryApi';
import { areaLabel, buildDirectory, matchesSearch } from '@/lib/directory';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import DirectoryForm from '@/components/DirectoryForm';

const D = s.directory;

export default function DirectoryPage() {
  const [data, setData] = useState({ loading: true, failed: false, parties: [], responsibilities: [], cats: [], regions: [] });
  const [mine, setMine] = useState([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      // Contact details are not readable by the public: these are the safe columns only.
      const [p, r, c, g] = await Promise.all([
        supabase.from('responsible_parties').select('id, name, type, region_id, verified').eq('verified', true),
        supabase.from('category_responsibilities').select('party_id, category_id, region_id'),
        supabase.from('categories').select('id, name'),
        supabase.from('regions').select('id, name, level, parent_id'),
      ]);
      if (p.error || r.error || c.error || g.error) throw p.error || r.error || c.error || g.error;
      setData({ loading: false, failed: false, parties: p.data, responsibilities: r.data, cats: c.data, regions: g.data });
    } catch (e) {
      console.error(e);
      setData((d) => ({ ...d, loading: false, failed: true }));
    }
    setMine(await mySuggestions());
  }, []);
  useEffect(() => { load(); }, [load]);

  const catName = useMemo(() => Object.fromEntries(data.cats.map((c) => [c.id, label(c.name)])), [data.cats]);
  const regionsById = useMemo(() => Object.fromEntries(data.regions.map((r) => [r.id, r])), [data.regions]);
  const areaName = useCallback((id) => areaLabel(id, regionsById), [regionsById]);
  const pickable = useMemo(() => data.regions.filter((r) => ['region', 'city'].includes(r.level)), [data.regions]);
  const entries = useMemo(() => buildDirectory(data.parties, data.responsibilities), [data.parties, data.responsibilities]);
  const shown = useMemo(() => entries.filter((e) => matchesSearch(e, query, { catName, areaName })), [entries, query, catName, areaName]);

  return (
    <main className="wrap">
      <h1 className="page-title">{D.title}</h1>
      <p>{D.intro}</p>

      {data.loading && <p className="hint">{s.loading}</p>}
      {data.failed && <p className="warn">{D.loadFailed}</p>}
      {!data.loading && !data.failed && (
        <>
          <details className="panel">
            <summary><strong>{D.addTitle}</strong></summary>
            <DirectoryForm regions={pickable} categories={data.cats} onSent={load} />
          </details>

          <label>{D.search}
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>

          {entries.length === 0 && <p className="hint">{D.empty}</p>}
          {entries.length > 0 && shown.length === 0 && <p className="hint">{D.none}</p>}
          <ul className="cards">
            {shown.map((e) => (
              <li key={e.id}>
                <p><strong>{e.name}</strong> <span className="chip">{s.admin.typeOptions[e.type] ?? e.type}</span></p>
                {e.region_id && <p className="hint">{areaName(e.region_id)}</p>}
                {e.coverage.length === 0 && <p className="hint">{D.unlisted}</p>}
                {e.coverage.map((c) => (
                  <p key={c.region_id}>
                    {D.handles}: {c.category_ids.map((id) => catName[id]).filter(Boolean).join(', ')} <span className="hint">· {areaName(c.region_id)}</span>
                  </p>
                ))}
                <details>
                  <summary>{D.changeTitle}</summary>
                  <DirectoryForm party={e} regions={pickable} categories={data.cats} onSent={load} />
                </details>
              </li>
            ))}
          </ul>

          {mine.length > 0 && (
            <>
              <h2>{D.mine}</h2>
              <ul className="cards">
                {mine.map((m) => (
                  <li key={m.id}>
                    <p><strong>{D.kindLabel[m.kind]}</strong>{m.name ? `: ${m.name}` : ''} <span className="chip">{D.status[m.status]}</span></p>
                    {m.review_note && <p className="hint">{m.review_note}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
