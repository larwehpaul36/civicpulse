'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { compressImage } from '@/lib/compressImage';
import { linksOf, otherEnd, parseIssueId, suggestions } from '@/lib/relatedIssues';
import { strings as s } from '@/lib/strings';

const A = s.admin;
const photoUrl = (path) => supabase.storage.from('issue-photos').getPublicUrl(path).data.publicUrl;
const mapUrl = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
const errText = (e) =>
  /after_photo_required/.test(e?.message) ? A.needAfter :
  /party_required/.test(e?.message) ? A.needParty :
  /same_issue/.test(e?.message) ? A.links.sameIssue :
  /issue_not_found/.test(e?.message) ? A.links.notFound : s.failed;

async function rpc(name, args) {
  const { error } = await supabase.rpc(name, args);
  if (error) throw error;
}

export default function AdminIssue({ issue: i, categoryName, categoryNames = {}, parties, allIssues = [], links = [], onChanged }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [partyId, setPartyId] = useState(i.party_id ?? '');
  const [remember, setRemember] = useState(true);
  const [file, setFile] = useState(null);
  const [channel, setChannel] = useState('other');
  const [relation, setRelation] = useState('duplicate');
  const [manualId, setManualId] = useState('');

  async function run(fn, ok = A.done) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(ok); await onChanged(); }
    catch (e) { console.error(e); setMsg(errText(e)); }
    finally { setBusy(false); }
  }

  const message = () => A.escalationMessage({
    party: i.party_name ?? '',
    category: categoryName,
    description: i.description,
    severity: s.severityOptions[i.severity],
    days: i.days_open,
    confirmations: i.confirmation_count,
    mapUrl: mapUrl(i.lat, i.lng),
    reportUrl: `${window.location.origin}/issues/${i.id}`,
  });

  const issueById = Object.fromEntries(allIssues.map((x) => [x.id, x]));
  const mine = linksOf(links, i.id);
  const nearby = suggestions(i, allIssues, links);
  const linkTo = (otherId) => run(() => rpc('admin_link_issues', { p_a: i.id, p_b: otherId, p_relation: relation }));
  const unlinkFrom = (otherId) => run(() => rpc('admin_unlink_issues', { p_a: i.id, p_b: otherId }));
  function linkManual() {
    const id = parseIssueId(manualId);
    if (!id) return setMsg(A.links.badId);
    run(async () => { await rpc('admin_link_issues', { p_a: i.id, p_b: id, p_relation: relation }); setManualId(''); });
  }
  const summary = (o) => `${categoryNames[o.category_id] ?? ''} · ${s.statusLabels[o.status] ?? o.status} · ${s.daysOpen(o.days_open)}`;

  const waNumber = (i.party_whatsapp || i.party_phone || '').replace(/\D/g, '');
  const setStatus = (status) => rpc('admin_set_status', { p_issue: i.id, p_status: status, p_note: null });

  function openWhatsApp() {
    setChannel('whatsapp');
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(message())}`, '_blank', 'noopener');
  }
  function openEmail() {
    setChannel('email');
    const subject = encodeURIComponent(`Unresolved problem reported by residents: ${categoryName}`);
    window.location.href = `mailto:${i.party_email}?subject=${subject}&body=${encodeURIComponent(message())}`;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(message()); setMsg(A.copied); } catch { setMsg(s.failed); }
  }

  const markSent = () => run(async () => {
    await setStatus('sent');
    await rpc('admin_log_contact', { p_issue: i.id, p_channel: channel, p_note: 'Case sent', p_response: false });
  });

  const markResolved = () => run(async () => {
    if (file) {
      const blob = await compressImage(file);
      const path = `after/${i.id}-${Date.now()}.jpg`;
      const up = await supabase.storage.from('issue-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      await rpc('admin_add_after_photo', { p_issue: i.id, p_path: path });
    }
    await setStatus('resolved');
    setFile(null);
  });

  const logContact = (response) => run(() =>
    rpc('admin_log_contact', { p_issue: i.id, p_channel: channel, p_note: null, p_response: response }));

  return (
    <li>
      <details className="admin-card">
        <summary>
          <span className="chip">{s.statusLabels[i.status] ?? i.status}</span>{' '}
          <strong>{categoryName}</strong>
          <span className="hint">
            {' '}· {s.daysOpen(i.days_open)} · {s.confirmations(i.confirmation_count)}
            {i.flag_count > 0 && <> · <strong>{A.flagsCount(i.flag_count)}</strong></>}
            {mine.length > 0 && <> · {A.links.count(mine.length)}</>}
          </span>
        </summary>

        <div className="admin-body">
          <p>{i.description || '—'}</p>
          <div className="photos">
            {i.before_path && <img src={photoUrl(i.before_path)} alt="" />}
            {i.after_path && <img src={photoUrl(i.after_path)} alt="" />}
          </div>
          <p><a href={mapUrl(i.lat, i.lng)} target="_blank" rel="noopener noreferrer">{A.exactLocation}</a></p>

          <h3>{A.links.title}</h3>
          {mine.length === 0 && <p className="hint">{A.links.none}</p>}
          <ul className="cards">
            {mine.map((l) => {
              const otherId = otherEnd(l, i.id);
              const o = issueById[otherId];
              return (
                <li key={otherId} className="admin-card">
                  <strong>{l.relation === 'duplicate' ? A.links.same : A.links.related}</strong>
                  <p className="hint">{o ? summary(o) : otherId}</p>
                  {o?.description && <p>{o.description.slice(0, 120)}</p>}
                  <div className="row">
                    <a href={`/issues/${otherId}`} target="_blank" rel="noopener noreferrer">{A.links.open}</a>
                    <button type="button" className="secondary" disabled={busy} onClick={() => unlinkFrom(otherId)}>{A.links.unlink}</button>
                  </div>
                </li>
              );
            })}
          </ul>

          <label>{A.links.linkAs}
            <select value={relation} onChange={(e) => setRelation(e.target.value)}>
              <option value="duplicate">{A.links.same}</option>
              <option value="related">{A.links.related}</option>
            </select>
          </label>
          <p className="hint">{A.links.nearby}</p>
          {nearby.length === 0 && <p className="hint">{A.links.noneNearby}</p>}
          <ul className="cards">
            {nearby.map(({ issue: o, meters }) => (
              <li key={o.id} className="admin-card">
                <p className="hint">{summary(o)} · {A.links.away(meters)}</p>
                {o.description && <p>{o.description.slice(0, 120)}</p>}
                <div className="row">
                  <a href={`/issues/${o.id}`} target="_blank" rel="noopener noreferrer">{A.links.open}</a>
                  <button type="button" className="secondary" disabled={busy} onClick={() => linkTo(o.id)}>{A.links.link}</button>
                </div>
              </li>
            ))}
          </ul>
          <label>{A.links.byId}
            <input type="text" value={manualId} onChange={(e) => setManualId(e.target.value)} />
          </label>
          <p><button type="button" className="secondary" disabled={busy || !manualId.trim()} onClick={linkManual}>{A.links.link}</button></p>

          <h3>{A.party}</h3>
          <div className="row">
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">{A.pickParty}</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className="secondary" disabled={busy || !partyId}
              onClick={() => run(() => rpc('admin_assign_party', { p_issue: i.id, p_party: partyId, p_remember: remember }))}>
              {A.assign}
            </button>
          </div>
          <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {A.remember}</label>

          {i.party_id && (
            <>
              <h3>{A.escalate}</h3>
              <div className="row">
                {waNumber && <button type="button" className="secondary" onClick={openWhatsApp}>{A.whatsapp}</button>}
                {i.party_email && <button type="button" className="secondary" onClick={openEmail}>{A.emailParty}</button>}
                <button type="button" className="secondary" onClick={copy}>{A.copy}</button>
              </div>
              {!waNumber && !i.party_email && <p className="hint">{A.noContactDetails}</p>}
            </>
          )}

          <h3>{s.history}</h3>
          <div className="row">
            {i.status !== 'sent' && <button type="button" disabled={busy} onClick={markSent}>{A.markSent}</button>}
            {i.status !== 'in_progress' && <button type="button" className="secondary" disabled={busy} onClick={() => run(() => setStatus('in_progress'))}>{A.markProgress}</button>}
            {i.status !== 'rejected' && <button type="button" className="secondary" disabled={busy} onClick={() => run(() => setStatus('rejected'))}>{A.reject}</button>}
            {i.party_id && <button type="button" className="secondary" disabled={busy} onClick={() => logContact(true)}>{A.logResponse}</button>}
            {i.party_id && <button type="button" className="secondary" disabled={busy} onClick={() => logContact(false)}>{A.logNoResponse}</button>}
            {i.flag_count > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => run(() => rpc('admin_dismiss_flags', { p_issue: i.id }))}>{A.dismissFlags}</button>}
          </div>

          {i.status !== 'resolved' && (
            <>
              <label>{A.afterPhoto}
                <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <p><button type="button" disabled={busy} onClick={markResolved}>{A.markResolved}</button></p>
            </>
          )}
          {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
        </div>
      </details>
    </li>
  );
}
