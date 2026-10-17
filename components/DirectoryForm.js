'use client';
import { useMemo, useState } from 'react';
import { suggestChange } from '@/lib/directoryApi';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';

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
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const areas = useMemo(() => {
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    return regions
      .map((r) => ({ id: r.id, text: r.level === 'city' && byId[r.parent_id] ? `${r.name}, ${byId[r.parent_id].name}` : r.name }))
      .sort((a, b) => a.text.localeCompare(b.text));
  }, [regions]);

  const togglePicked = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const showName = mode === 'new_party' || mode === 'correction';
  const showContacts = showName;
  const showCoverage = mode === 'new_party' || mode === 'coverage';

  async function send(e) {
    e.preventDefault();
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
    <form className="panel" onSubmit={send}>
      {party && (
        <label>{D.kindMode}
          <select value={mode} onChange={(e) => { setMode(e.target.value); setMsg(''); }}>
            {Object.entries(D.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {mode === 'correction' && <p className="hint">{D.onlyChange}</p>}

      {showName && (
        <label>{D.name}
          <input type="text" value={f.name} onChange={set('name')} placeholder={party?.name ?? ''} required={mode === 'new_party'} maxLength={120} />
        </label>
      )}
      {mode === 'new_party' && (
        <label>{D.type}
          <select value={f.type} onChange={set('type')} required>
            <option value="">{D.pickArea.replace('area', 'type')}</option>
            {Object.entries(s.admin.typeOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {showCoverage && (
        <>
          <label>{D.area}
            <select value={f.regionId} onChange={set('regionId')} required>
              <option value="">{D.pickArea}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}
            </select>
          </label>
          <fieldset className="panel">
            <legend>{D.problems}</legend>
            {categories.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={picked.includes(c.id)} onChange={() => togglePicked(c.id)} /> {label(c.name)}
              </label>
            ))}
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
      <label>{mode === 'wrong' ? D.noteWrong : D.note}
        <textarea value={f.note} onChange={set('note')} rows={3} maxLength={500} required={mode === 'wrong'} />
      </label>
      <button type="submit" disabled={busy}>{D.send}</button>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </form>
  );
}
