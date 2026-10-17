'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { changedFields } from '@/lib/directory';
import { strings as s } from '@/lib/strings';

const A = s.admin;
const FIELD_LABELS = { name: s.directory.name, email: 'Email', phone: 'Phone', whatsapp: 'WhatsApp' };

// One pending suggestion for a moderator: what is proposed, what it would replace, approve or reject.
export default function AdminSuggestion({ item, catName, regionName, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const d = A.directory;
  const cats = item.category_ids.map((id) => catName[id]).filter(Boolean).join(', ');
  const typeName = (t) => A.typeOptions[t] ?? t;

  async function review(approve) {
    setBusy(true); setMsg('');
    const { error } = await supabase.rpc('admin_review_suggestion', { p_id: item.id, p_approve: approve, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setMsg(/already_reviewed/.test(error.message) ? d.alreadyReviewed : d.failed);
    onChanged();
  }

  return (
    <li className="admin-card">
      <p>
        <strong>{d.kinds[item.kind]}</strong>
        {item.current ? <> · {item.current.name}</> : item.name ? <> · {item.name}</> : null}
        <span className="hint"> · {new Date(item.created_at).toLocaleDateString()}</span>
      </p>

      {item.kind === 'new_party' && (
        <>
          <p>{typeName(item.type)} · {regionName(item.region_id)}</p>
          <p>{d.handles}: {cats}</p>
        </>
      )}
      {item.kind === 'correction' && changedFields(item, item.current).map((c) => (
        <p key={c.field}>{FIELD_LABELS[c.field]}: <span className="hint">{c.from || '—'}</span> → <strong>{c.to}</strong></p>
      ))}
      {item.kind === 'coverage' && <p>{d.handles}: {cats} {d.inArea} {regionName(item.region_id)}</p>}
      {item.kind === 'wrong' && <p className="warn">{d.wrongWarning}</p>}

      {item.kind === 'new_party' && [['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp']].filter(([k]) => item[k]).map(([k, l]) => (
        <p key={k}>{l}: {item[k]}</p>
      ))}
      {item.note && <p>{d.note}: {item.note}</p>}

      <p className="hint">{d.approveHint}</p>
      <label>{d.rejectNote}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </label>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => review(true)}>{d.approve}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => review(false)}>{d.reject}</button>
      </div>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </li>
  );
}
