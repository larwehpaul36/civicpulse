'use client';
// Moderator follow-up list: reports where a reminder or an escalation is due. Nothing is sent automatically (migration 027 only gathers facts).
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { categoryTitle } from '@/lib/categoryTitle';
import { filterOffices } from '@/lib/places';
import { googleMapsUrl } from '@/lib/mapLinks';
import { followUpList, logNote } from '@/lib/followUp';
import { linkUrl, makeReplyLink } from '@/lib/replyLinks';
import '@/components/forms.css';

const F = s.admin.followUp;
const dateText = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const daysAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

function Card({ item, categoryNames, parties, onChanged }) {
  const { row: r, due } = item;
  const escalate = due.stage === 'escalate';
  const [replyUrl, setReplyUrl] = useState('');
  const [target, setTarget] = useState('');
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('other');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const category = categoryTitle(categoryNames[r.category_id] ?? '', r.other_label);
  const targetName = parties.find((p) => p.id === target)?.name ?? '';
  const facts = {
    party: r.party_name ?? '', category, description: r.description, confirmations: r.confirmation_count,
    days: due.days, late: due.late, expected: r.expected_date ? dateText(r.expected_date) : '', replies: r.replies_count,
    quiet: r.last_reply_at ? daysAgo(r.last_reply_at) : due.days, reminders: r.reminders_count ?? 0,
    mapUrl: googleMapsUrl(r.lat, r.lng), reportUrl: typeof window === 'undefined' ? '' : `${window.location.origin}/issues/${r.id}`,
    replyUrl, target: targetName,
  };
  const message = escalate ? F.escalateMessage(facts) : F.reminderMessage(facts);
  const subject = escalate ? F.subject.escalate(category, r.party_name ?? '') : F.subject.remind(category);
  const number = (r.party_whatsapp || r.party_phone || '').replace(/\D/g, '');
  const found = filterOffices(parties.filter((p) => p.id !== r.party_id), q).slice(0, 60);

  function typeTarget(e) {
    const v = e.target.value; setQ(v);
    const hits = filterOffices(parties.filter((p) => p.id !== r.party_id), v);
    if (v.trim() && hits.length === 1) setTarget(hits[0].id);
  }
  async function addLink() {
    setBusy(true); setMsg('');
    const res = await makeReplyLink(supabase, r.id);
    if (res.token) { setReplyUrl(linkUrl(window.location.origin, res.token)); setMsg(s.admin.replyLink.added); }
    else setMsg(s.admin.replyLink.errors[res.error] ?? s.admin.replyLink.errors.failed);
    setBusy(false);
  }
  // WhatsApp: to the office's number for a reminder; for an escalation the moderator picks the person, so no number.
  function openWhatsApp() {
    setChannel('whatsapp');
    window.open(`https://wa.me/${escalate ? '' : number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }
  function openEmail() {
    setChannel('email');
    window.location.href = `mailto:${escalate ? '' : r.party_email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(message); setMsg(F.copied); } catch { setMsg(F.failed); }
  }
  async function record() {
    setBusy(true); setMsg('');
    const { error } = await supabase.rpc('admin_log_contact', { p_issue: r.id, p_channel: channel, p_note: logNote(escalate ? 'escalate' : 'remind', targetName), p_response: false });
    setBusy(false);
    if (error) return setMsg(F.failed);
    setMsg(F.recorded); onChanged?.();
  }

  return (
    <li>
      <details className="admin-card">
        <summary>
          <span className="chip">{F.stages[due.stage]}</span>{' '}
          <strong>{category}</strong>
          <span className="hint"> · {r.party_name} · {due.days} {due.days === 1 ? 'day' : 'days'}</span>
        </summary>
        <div className="panel admin-body">
          <p><strong>{F.why[due.stage]({ ...facts })}</strong></p>
          <p className="hint">{F.sentTo(r.party_name ?? '')}{r.reminders_count > 0 && <> · {F.remindersSent(r.reminders_count)}</>}</p>
          {r.description && <p>{r.description}</p>}

          {escalate ? (
            <>
              <label>{F.escalateTo}
                <input type="search" value={q} onChange={typeTarget} placeholder={s.admin.searchPartyHint} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
              </label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={F.escalateTo}>
                <option value="">—</option>
                {(target && !found.some((p) => p.id === target) ? [parties.find((p) => p.id === target), ...found].filter(Boolean) : found).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="hint">{F.escalateHint}</p>
            </>
          ) : (
            <div className="row">
              <button type="button" className="secondary" disabled={busy || !!replyUrl} onClick={addLink}>{s.admin.replyLink.add}</button>
            </div>
          )}

          <div className="row">
            {(escalate || number) && <button type="button" className="secondary" onClick={openWhatsApp}>{escalate ? F.whatsappPick : F.whatsapp}</button>}
            {(escalate || r.party_email) && <button type="button" className="secondary" onClick={openEmail}>{F.email}</button>}
            <button type="button" className="secondary" onClick={copy}>{F.copy}</button>
          </div>
          {!escalate && !number && !r.party_email && <p className="hint">{s.admin.noContactDetails}</p>}
          <p><button type="button" disabled={busy} onClick={record}>{escalate ? F.sentEscalation : F.sentReminder}</button></p>
          {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
        </div>
      </details>
    </li>
  );
}

export default function AdminFollowUp({ rows, categoryNames, parties, onChanged }) {
  const list = followUpList(rows);
  return (
    <section aria-label={F.title}>
      <h2>{F.title}</h2>
      <p className="hint">{F.intro}</p>
      {list.length === 0 ? <p>{F.none}</p> : (
        <ul className="cards">
          {list.map((x) => <Card key={x.row.id} item={x} categoryNames={categoryNames} parties={parties} onChanged={onChanged} />)}
        </ul>
      )}
    </section>
  );
}
