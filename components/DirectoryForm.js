'use client';
import { placeLabel } from '@/lib/places';
import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestChange } from '@/lib/directoryApi';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { directoryMissing } from '@/lib/formRules';
import { Req } from '@/components/Req';
import '@/components/forms.css';

const D = s.directory;
const errorText = (err) => {
  const code = Object.keys(D.errors).find((k) => new RegExp(k).test(err?.message ?? ''));
  return D.errors[code] ?? D.errors.failed;
};

// One form for all four kinds of suggestion. With no `party` it proposes a new one;
// with a `party` the person picks: correct details, add coverage, or say it is wrong.
export default function DirectoryForm({ party = null, regions, categories, onSent }) {
  const [mode, setMode] = useState(party ? 'correction' : 'new_party');
  const [f, setF] = useState({ name: '', type: '', regionId: '', email: '', phone: '', whatsapp: '', note: '' });
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const [tried, setTried] = useState(false); // pressed Send with something missing
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const areas = useMemo(() => {
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    return regions
      .map((r) => ({ id: r.id, text: placeLabel(r, byId) }))
      .sort((a, b) => a.text.localeCompare(b.text));
  }, [regions]);

  const togglePicked = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const showName = mode === 'new_party' || mode === 'correction';
  const showContacts = showName;
  const showCoverage = mode === 'new_party' || mode === 'coverage';

  // What is still empty. Messages show only after Send was pressed, and vanish by themselves once fixed.
  const miss = directoryMissing(mode, f, picked.length);
  const bad = (k) => tried && miss.includes(k);
  const invalid = (k) => (bad(k) ? 'true' : undefined);
  const why = (k) => (bad(k) ? `err-${k}` : undefined);
  const fix = (k) => bad(k) && <span id={`err-${k}`} className="fielderr">{s.req.dir[k]}</span>;
  useEffect(() => {
    if (attempt) formRef.current?.querySelector('[aria-invalid="true"],[data-invalid="true"]')?.focus();
  }, [attempt]);

  async function send(e) {
    e.preventDefault();
    if (miss.length) { setTried(true); setAttempt((n) => n + 1); setMsg(''); return; }
    setBusy(true); setMsg('');
    try {
      await suggestChange({
        kind: mode,
        partyId: party?.id,
        name: showName ? f.name : null,
        type: mode === 'new_party' ? f.type : null,
        regionId: showCoverage ? f.regionId : null,
        categoryIds: showCoverage ? picked : [],
        email: showContacts ? f.email : null,
        phone: showContacts ? f.phone : null,
        whatsapp: showContacts ? f.whatsapp : null,
        note: f.note,
      });
      setSent(true);
      onSent?.();
    } catch (err) {
      console.error(err);
      setMsg(errorText(err));
    } finally { setBusy(false); }
  }

  if (sent) return <p aria-live="polite"><strong>{D.thanks}</strong></p>;

  return (
    <form ref={formRef} className="panel" onSubmit={send} noValidate>
      {party && (
        <label>{D.kindMode}
          <select value={mode} onChange={(e) => { setMode(e.target.value); setMsg(''); setTried(false); }}>
            {Object.entries(D.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {mode === 'correction' && <p className="hint">{D.onlyChange}</p>}
      {mode !== 'correction' && <p className="hint reqnote"><span className="req" aria-hidden="true">*</span> {s.req.note}</p>}

      {showName && (
        <label><span>{D.name}{mode === 'new_party' && <Req />}</span>
          <input type="text" value={f.name} onChange={set('name')} placeholder={party?.name ?? ''} maxLength={120} aria-required={mode === 'new_party' || undefined} aria-invalid={invalid('name')} aria-describedby={why('name')} />
          {fix('name')}
        </label>
      )}
      {mode === 'new_party' && (
        <label><span>{D.type}<Req /></span>
          <select value={f.type} onChange={set('type')} aria-required="true" aria-invalid={invalid('type')} aria-describedby={why('type')}>
            <option value="">{D.pickArea.replace('area', 'type')}</option>
            {Object.entries(s.admin.typeOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {fix('type')}
        </label>
      )}
      {showCoverage && (
        <>
          <label><span>{D.area}<Req /></span>
            <select value={f.regionId} onChange={set('regionId')} aria-required="true" aria-invalid={invalid('area')} aria-describedby={why('area')}>
              <option value="">{D.pickArea}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}
            </select>
            {fix('area')}
          </label>
          <fieldset className="panel" tabIndex={-1} data-invalid={invalid('problems')} aria-describedby={why('problems')}>
            <legend>{D.problems}<Req /></legend>
            {categories.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={picked.includes(c.id)} onChange={() => togglePicked(c.id)} /> {label(c.name)}
              </label>
            ))}
            {fix('problems')}
          </fieldset>
        </>
      )}
      {showContacts && (
        <>
          <label>{D.email}<input type="email" value={f.email} onChange={set('email')} autoComplete="off" /></label>
          <label>{D.phone}<input type="tel" value={f.phone} onChange={set('phone')} autoComplete="off" /></label>
          <label>{D.whatsapp}<input type="tel" value={f.whatsapp} onChange={set('whatsapp')} autoComplete="off" /></label>
          <p className="hint">{D.whatsappHint}</p>
        </>
      )}
      <label><span>{mode === 'wrong' ? D.noteWrong : D.note}{mode === 'wrong' && <Req />}</span>
        <textarea value={f.note} onChange={set('note')} rows={3} maxLength={500} aria-required={mode === 'wrong' || undefined} aria-invalid={invalid('note')} aria-describedby={why('note')} />
        {fix('note')}
      </label>
      <button type="submit" disabled={busy}>{D.send}</button>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </form>
  );
}
