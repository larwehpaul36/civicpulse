'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { categoryTitle } from '@/lib/categoryTitle';

const IssuesMap = dynamic(() => import('@/components/IssuesMap'), {
  ssr: false,
  loading: () => <div className="map tall" />,
});

export default function IssuesPage() {
  const router = useRouter();
  const [issues, setIssues] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cat, setCat] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    (async () => {
      const [i, c] = await Promise.all([
        supabase.from('public_issues').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('categories').select('id, name'),
      ]);
      setIssues(i.data ?? []);
      setCategories(c.data ?? []);
    })();
  }, []);

  const catName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, label(c.name)])),
    [categories]
  );

  const shown = useMemo(
    () =>
      (issues ?? []).filter(
        (i) =>
          (!cat || i.category_id === cat) &&
          (!state || (state === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved'))
      ),
    [issues, cat, state]
  );

  return (
    <main className="wrap wide">
      <h1 className="page-title">{s.issuesTitle}</h1>

      <div className="filters">
        <label>{s.filterCategory}
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{s.all}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{label(c.name)}</option>)}
          </select>
        </label>
        <label>{s.filterStatus}
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{s.all}</option>
            <option value="open">{s.openOnly}</option>
            <option value="resolved">{s.resolvedOnly}</option>
          </select>
        </label>
      </div>

      <IssuesMap issues={shown} onSelect={(id) => router.push(`/issues/${id}`)} />

      {issues === null && <p className="hint">{s.loading}</p>}
      {issues !== null && shown.length === 0 && <p>{s.noReports}</p>}

      <ul className="cards">
        {shown.map((i) => (
          <li key={i.id}>
            <Link href={`/issues/${i.id}`}>
              <span className="chip">{s.statusLabels[i.status]}</span>
              <strong>{categoryTitle(catName[i.category_id] ?? '', i.other_label)}</strong>
              <span>{i.description || '—'}</span>
              <span className="hint">{s.daysOpen(i.days_open)} · {s.confirmations(i.confirmation_count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
