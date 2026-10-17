'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase, ensureUser } from '@/lib/supabase';
import { queue, syncer } from '@/lib/sync';
import { useOutbox } from '@/lib/useOutbox';
import { readCachedRefData, fetchRefData } from '@/lib/refData';
import { compressImage } from '@/lib/compressImage';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => <div className="map" />,
});

const EMPTY = { categoryId: '', regionId: '', severity: 'medium', description: '' };

// The similar-reports check is a nicety. With no signal (or a slow one) skip it rather than block the report.
async function findDuplicates(loc, categoryId) {
  const check = (async () => {
    await ensureUser();
    const { data, error } = await supabase.rpc('find_nearby_duplicates', {
      lat: loc.lat, lng: loc.lng, cat: categoryId, radius_m: 50,
    });
    return error ? null : data;
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 6000));
  try { return await Promise.race([check, timeout]); } catch { return null; }
}

export default function ReportForm() {
  const [categories, setCategories] = useState([]);
  const [regions, setRegions] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [loc, setLoc] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | checking | saving | done
  const [error, setError] = useState('');
  const [dupes, setDupes] = useState([]);
  const [confirmedIds, setConfirmedIds] = useState([]);
  const [savedId, setSavedId] = useState(null);
  const { items, running } = useOutbox();

  // Show the copy kept on this phone straight away, then refresh it when there is signal.
  useEffect(() => {
    let alive = true;
    const cached = readCachedRefData();
    if (cached) { setCategories(cached.categories); setRegions(cached.regions); }
    fetchRefData().then((fresh) => {
      if (alive && fresh) { setCategories(fresh.categories); setRegions(fresh.regions); }
    });
    return () => { alive = false; };
  }, []);

  const regionOptions = useMemo(() => {
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    return regions.map((r) => ({
      id: r.id,
      text: r.level === 'city' && byId[r.parent_id] ? `${r.name}, ${byId[r.parent_id].name}` : r.name,
    }));
  }, [regions]);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });

  // Every report is saved on the phone first, then sent. A weak signal can no longer lose it.
  async function submit(skipDuplicateCheck = false) {
    setError('');
    if (!f.categoryId || !f.regionId || !photo || !loc) return setError(s.missing);
    try {
      if (!skipDuplicateCheck && navigator.onLine) {
        setStatus('checking');
        const found = await findDuplicates(loc, f.categoryId);
        if (found?.length) { setDupes(found); return setStatus('idle'); }
      }

      setStatus('saving');
      const id = crypto.randomUUID();
      const blob = await compressImage(photo);
      await queue.enqueue({
        id,
        categoryId: f.categoryId,
        regionId: f.regionId,
        severity: f.severity,
        description: f.description.trim() || null,
        loc,
        photo: blob,
      });
      setSavedId(id);
      setStatus('done');
      syncer.syncAll({ ignoreBackoff: true }).catch(() => {});
    } catch (err) {
      console.error(err);
      setError(s.saveFailed);
      setStatus('idle');
    }
  }

  async function confirm(issueId) {
    try {
      const user = await ensureUser();
      const { error } = await supabase.from('confirmations').insert({ issue_id: issueId, user_id: user.id });
      if (error && error.code !== '23505') throw error; // 23505 = already confirmed
      setConfirmedIds((ids) => [...ids, issueId]);
    } catch (err) {
      console.error(err);
      setError(s.failed);
    }
  }

  function reset() {
    setF(EMPTY); setPhoto(null); setLoc(null); setDupes([]); setConfirmedIds([]); setSavedId(null); setStatus('idle');
  }

  if (status === 'done') {
    const sent = syncer.hasSent(savedId);
    const failed = items.find((i) => i.id === savedId)?.status === 'failed';
    const title = sent ? s.sentTitle : failed ? s.outbox.failedTitle : running ? s.outbox.sendingTitle : s.outbox.savedTitle;
    const body = sent ? s.sentBody : failed ? s.outbox.failedBody : s.outbox.savedBody;
    return (
      <section className="panel" aria-live="polite">
        <h2>{title}</h2>
        <p>{body}</p>
        <p><Link href="/my">{s.mine.getUpdates}</Link></p>
        <button type="button" onClick={reset}>{s.another}</button>
      </section>
    );
  }

  if (dupes.length)
    return (
      <section className="panel">
        <h2>{s.dupTitle}</h2>
        <p className="hint">{s.dupHelp}</p>
        <ul className="dupes">
          {dupes.map((d) => (
            <li key={d.id}>
              <p>{d.description || '—'}</p>
              <p className="hint">{s.daysOpen(d.days_open)} · {s.confirmations(d.confirmation_count)}</p>
              {confirmedIds.includes(d.id)
                ? <p><strong>{s.confirmed}</strong></p>
                : <button type="button" onClick={() => confirm(d.id)}>{s.confirmIt}</button>}
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="secondary" onClick={() => { setDupes([]); submit(true); }}>
          {s.differentIssue}
        </button>
      </section>
    );

  const busy = status !== 'idle';

  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <label>{s.category}
        <select value={f.categoryId} onChange={set('categoryId')} required>
          <option value="">{s.choose}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {label(c.category_groups?.name)}: {label(c.name)}
            </option>
          ))}
        </select>
      </label>

      <label>{s.region}
        <select value={f.regionId} onChange={set('regionId')} required>
          <option value="">{s.choose}</option>
          {regionOptions.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
        </select>
      </label>

      <label>{s.severity}
        <select value={f.severity} onChange={set('severity')}>
          {Object.entries(s.severityOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>

      <label>{s.photo}
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} required />
        <span className="hint">{s.photoHelp}</span>
      </label>
      {preview && <img className="preview" src={preview} alt="" />}

      <div className="field">
        <span className="label">{s.location}</span>
        <LocationPicker value={loc} onChange={setLoc} />
      </div>

      <label>{s.description}
        <textarea rows={3} value={f.description} onChange={set('description')} maxLength={500} />
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {status === 'checking' ? s.checking : status === 'saving' ? s.saving : s.submit}
      </button>
    </form>
  );
}
