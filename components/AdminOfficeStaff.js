'use client';
// Moderator side of the office page: invite an assembly's staff by email, and switch them off. Migration 026.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { filterOffices } from '@/lib/places';
import { inviteStaff, listStaff, normEmail, revokeStaff } from '@/lib/officeStaff';
import '@/components/forms.css';

const S = s.admin.staff;
const dateText = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminOfficeStaff({ parties }) {
  const [list, setList] = useState([]);
  const [email, setEmail] = useState('');
  const [q, setQ] = useState('');
  const [partyId, setPartyId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(null);   // { email, office } after a successful invite
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await listStaff(supabase);
    setList(r.staff ?? []);
    if (r.error) setMsg(S.errors.failed);
  }, []);
  useEffect(() => { load(); }, [load]);

  const found = filterOffices(parties, q).slice(0, 100);
  const choices = !partyId || found.some((p) => p.id === partyId) ? found : [parties.find((p) => p.id === partyId), ...found].filter(Boolean);
  function typeOffice(e) {
    const v = e.target.value; setQ(v);
    const hits = filterOffices(parties, v);
    if (v.trim() && hits.length === 1) setPartyId(hits[0].id);   // one match left: pick it
  }

  async function add(e) {
    e.preventDefault();
    if (!partyId) return setMsg(S.needOffice);
    setBusy(true); setMsg(''); setCopied(false);
    const r = await inviteStaff(supabase, email, partyId);
    setBusy(false);
    if (r.error) return setMsg(S.errors[r.error] ?? S.errors.failed);
    setInvite({ email: normEmail(email), office: parties.find((p) => p.id === partyId)?.name ?? '' });
    setMsg(S.invited); setEmail('');
    load();
  }
  async function off(id) {
    setBusy(true); setMsg('');
    const r = await revokeStaff(supabase, id);
    setBusy(false);
    setMsg(r.error ? (S.errors[r.error] ?? S.errors.failed) : S.revoked);
    load();
  }

  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/office`;
  const text = invite ? S.message(invite.office, url) : '';
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <section aria-label={S.title}>
      <h2>{S.title}</h2>
      <p className="hint">{S.intro}</p>
      <form className="panel" noValidate onSubmit={add}>
        <label>{S.email}
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>{s.admin.searchParty}
          <input type="search" value={q} onChange={typeOffice} placeholder={s.admin.searchPartyHint} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        </label>
        <label>{S.office}
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">{s.admin.pickParty}</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy}>{busy ? S.inviting : S.invite}</button>
        {msg && <p role="status" aria-live="polite"><strong>{msg}</strong></p>}
      </form>

      {invite && (
        <div className="panel">
          <h3>{S.messageTitle}</h3>
          <textarea readOnly rows={9} value={text} aria-label={S.messageTitle} />
          <p className="cta-row">
            <button type="button" className="secondary" onClick={copy}>{copied ? S.copied : S.copy}</button>
            <a className="cta ghost" href={`mailto:${invite.email}?subject=${encodeURIComponent('CivicPulse')}&body=${encodeURIComponent(text)}`}>Email</a>
          </p>
        </div>
      )}

      {list.length === 0 ? <p>{S.none}</p> : (
        <ul className="cards">
          {list.map((x) => (
            <li key={x.id}>
              <div className="admin-card">
                <p><strong>{x.party_name}</strong></p>
                <p>{x.email}</p>
                <p className="hint">{S.lastSeen(x.last_seen_at ? dateText(x.last_seen_at) : '')}</p>
                <button type="button" className="secondary" disabled={busy} onClick={() => off(x.id)}>{S.revoke}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
