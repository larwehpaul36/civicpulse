'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '@/lib/newId';
import { categoryTitle } from '@/lib/categoryTitle';
import { useVerify } from '@/components/PhoneVerify';
import { needsPhone } from '@/lib/verifyFlow';
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

const EMPTY = { categoryId: '', regionId: '', severity: 'medium', description: '', otherLabel: '' };

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
  const [step, setStep] = useState(0); // 0 problem, 1 place, 2 review
  const formRef = useRef(null);
  const moved = useRef(false);
  const [error, setError] = useState('');
  const ask = useVerify();
  const [detail, setDetail] = useState('');
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
  // "Other problem": the person names it in a few words, and a moderator finds the right office.
  const otherId = categories.find((c) => c.slug === 'other')?.id;
  const isOther = !!otherId && f.categoryId === otherId;

  // Every report is saved on the phone first, then sent. A weak signal can no longer lose it.
  async function submit(skipDuplicateCheck = false) {
    setError('');
    setDetail('');
    if (!f.categoryId || !f.regionId || !photo || !loc) return setError(s.missing);
    if (isOther && !f.otherLabel.trim()) return setError(s.other.missing);
    let stage = 'start';
    try {
      if (!skipDuplicateCheck && !isOther && navigator.onLine) {
        setStatus('checking');
        stage = 'duplicates';
        // A failed duplicate check must never stop someone from reporting.
        const found = await findDuplicates(loc, f.categoryId).catch(() => []);
        if (found?.length) { setDupes(found); return setStatus('idle'); }
      }

      setStatus('saving');
      stage = 'id';
      const id = newId();
      stage = 'photo';
      const blob = await compressImage(photo);
      stage = 'save';
      await queue.enqueue({
        id,
        categoryId: f.categoryId,
        regionId: f.regionId,
        severity: f.severity,
        description: f.description.trim() || null,
        otherLabel: isOther ? f.otherLabel.trim().slice(0, 80) : null,
        loc,
        photo: blob,
      });
      setSavedId(id);
      setStatus('done');
      syncer.syncAll({ ignoreBackoff: true }).catch(() => {});
    } catch (err) {
      console.error(err);
      setError(stage === 'photo' ? s.photoFailed : stage === 'save' ? s.saveFailed : s.failed);
      // Short technical note so a problem on one phone model can be traced.
      setDetail(`${stage}: ${err?.name ?? 'Error'}${err?.message ? ` - ${err.message}` : ''}`.slice(0, 160));
      setStatus('idle');
    }
  }

  async function confirm(issueId, retried = false) {
    try {
      const user = await ensureUser();
      const { error } = await supabase.from('confirmations').insert({ issue_id: issueId, user_id: user.id });
      if (error && needsPhone(error) && !retried) {
        if (await ask()) return confirm(issueId, true);
        return setError(s.verify.cancelled);
      }
      if (error && error.code !== '23505') throw error; // 23505 = already confirmed
      setConfirmedIds((ids) => [...ids, issueId]);
    } catch (err) {
      console.error(err);
      setError(s.failed);
    }
  }

  function reset() {
    setF(EMPTY); setPhoto(null); setLoc(null); setDupes([]); setConfirmedIds([]); setSavedId(null); setStatus('idle'); setStep(0);
    setError(''); setDetail('');
  }

  // Keep the card in view when the step changes (but not on first load).
  useEffect(() => {
    if (!moved.current) { moved.current = true; return; }
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [step]);

  function next() {
    setError(''); setDetail('');
    if (step === 0 && (!f.categoryId || !photo)) return setError(s.flow.miss0);
    if (step === 0 && isOther && !f.otherLabel.trim()) return setError(s.other.missing);
    if (step === 1 && (!f.regionId || !loc)) return setError(s.flow.miss1);
    setStep((n) => Math.min(2, n + 1));
  }
  function back() { setError(''); setDetail(''); setStep((n) => Math.max(0, n - 1)); }

  if (status === 'done') {
    const sent = syncer.hasSent(savedId);
    const state = items.find((i) => i.id === savedId)?.status;
    const failed = state === 'failed';
    const hold = state === 'needs_phone'; // a second report today: saved, waiting for the phone check
    const title = sent ? s.sentTitle : hold ? s.verify.holdTitle : failed ? s.outbox.failedTitle : running ? s.outbox.sendingTitle : s.outbox.savedTitle;
    const body = sent ? s.sentBody : hold ? s.verify.holdBody : failed ? s.outbox.failedBody : s.outbox.savedBody;
    return (
      <section className={`panel done${failed ? ' done-bad' : ''}`} aria-live="polite">
        <div className="tick" aria-hidden="true">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M14 27l8 8 16-17" /></svg>
          <div className="confetti">{Array.from({ length: 16 }, (_, k) => <i key={k} style={{ '--i': k }} />)}</div>
        </div>
        <h2>{title}</h2>
        <p>{body}</p>
        {hold && <button type="button" onClick={async () => { if (await ask()) syncer.resumeAfterVerification().catch(() => {}); }}>{s.verify.verifyToSend}</button>}
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
        {error && <p className="error" role="alert">{error}{detail && <small className="hint"> ({detail})</small>}</p>}
        <button type="button" className="secondary" onClick={() => { setDupes([]); submit(true); }}>
          {s.differentIssue}
        </button>
      </section>
    );

  const busy = status !== 'idle';
  const cat = categories.find((c) => c.id === f.categoryId);
  const regionText = regionOptions.find((r) => r.id === f.regionId)?.text;

  return (
    <form ref={formRef} className="panel" onSubmit={(e) => { e.preventDefault(); if (step < 2) next(); else submit(false); }}>
      <ol className="stepper" aria-hidden="true">{[0, 1, 2].map((n) => <li key={n} className={n <= step ? 'on' : ''} />)}</ol>
      <p className="stepcount" aria-live="polite">{s.flow.of(step + 1)} · {s.flow.names[step]}</p>

      <div className="stepbody" hidden={step !== 0}>
        <label>{s.category}
          <select value={f.categoryId} onChange={set('categoryId')} aria-required="true">
            <option value="">{s.choose}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{label(c.category_groups?.name)}: {label(c.name)}</option>
            ))}
          </select>
        </label>
        {isOther && (
          <label>{s.other.label}
            <input type="text" value={f.otherLabel} onChange={set('otherLabel')} maxLength={80} aria-required="true" />
            <span className="hint">{s.other.hint}</span>
          </label>
        )}
        <label>{s.severity}
          <select value={f.severity} onChange={set('severity')}>
            {Object.entries(s.severityOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{s.photo}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} aria-required="true" />
          <span className="hint">{s.photoHelp}</span>
        </label>
        {preview && <img className="preview" src={preview} alt={s.a11y.yourPhoto} />}
      </div>

      <div className="stepbody" hidden={step !== 1}>
        <label>{s.region}
          <select value={f.regionId} onChange={set('regionId')} aria-required="true">
            <option value="">{s.choose}</option>
            {regionOptions.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="label">{s.location}</span>
          {step === 1 && <LocationPicker value={loc} onChange={setLoc} />}
        </div>
      </div>

      <div className="stepbody" hidden={step !== 2}>
        <label>{s.description}
          <textarea rows={3} value={f.description} onChange={set('description')} maxLength={500} />
        </label>
        <dl className="review">
          <dt>{s.flow.rProblem}</dt><dd>{cat ? categoryTitle(label(cat.name), isOther ? f.otherLabel.trim() : null) : '—'} · {s.severityOptions[f.severity]}</dd>
          <dt>{s.flow.rPlace}</dt><dd>{regionText || '—'}{loc ? ` · ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : ''}</dd>
          <dt>{s.flow.rPhoto}</dt><dd>{preview ? <img className="thumb" src={preview} alt={s.a11y.yourPhoto} /> : '—'}</dd>
        </dl>
      </div>

      {error && <p className="error" role="alert">{error}{detail && <small className="hint"> ({detail})</small>}</p>}
      <div className="steprow">
        {step > 0 && <button type="button" className="secondary" onClick={back} disabled={busy}>{s.flow.back}</button>}
        <button type="submit" disabled={busy}>
          {step < 2 ? s.flow.next : status === 'checking' ? s.checking : status === 'saving' ? s.saving : s.submit}
        </button>
      </div>
    </form>
  );
}
