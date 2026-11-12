'use client';
// Moderator side: record what an office told us. Shown inside the case panel in /admin.
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { addReply, hideReply, loadAdminReplies, MAX_LEN } from '@/lib/officeReplies';

const R = s.admin.replies;
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminReplyForm({ issueId, hasParty }) {
  const [list, setList] = useState([]);
  const [kind, setKind] = useState('reply');
  const [body, setBody] = useState('');
  const [expected, setExpected] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => loadAdminReplies(supabase, issueId).then(setList), [issueId]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true); setMsg('');
    const r = await addReply(supabase, issueId, { kind, body, expected }, today());
    if (r.error) setMsg(R.errors[r.error] ?? R.errors.failed);
    else { setBody(''); setExpected(''); setMsg(R.saved); await load(); }
    setBusy(false);
  }
  async function hide(id) {
    setBusy(true); setMsg('');
    const r = await hideReply(supabase, id);
    setMsg(r.error ? (R.errors[r.error] ?? R.errors.failed) : R.hiddenOk);
    await load(); setBusy(false);
  }

  return (
    <>
      <h3>{R.title}</h3>
      <p className="hint">{R.help}</p>
      {!hasParty ? <p className="hint">{R.needParty}</p> : (
        <>
          <label>{R.kind}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="reply">{R.reply}</option>
              <option value="expected_date">{R.expected}</option>
              <option value="not_ours">{R.notOurs}</option>
            </select>
          </label>
          {kind === 'expected_date' && (
            <label>{R.date}<input type="date" value={expected} min={today()} onChange={(e) => setExpected(e.target.value)} /></label>
          )}
          <label>{R.text}
            <textarea rows={3} maxLength={MAX_LEN} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <p><button type="button" disabled={busy} onClick={submit}>{R.add}</button></p>
        </>
      )}
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
      {list.length > 0 && (
        <ul className="timeline">
          {list.map((r) => (
            <li key={r.id}>
              {new Date(r.created_at).toLocaleDateString()}: {r.kind === 'expected_date' ? r.expected_date : r.kind === 'not_ours' ? '⚠ ' : ''}{r.body ? ` “${r.body}”` : ''}
              {r.removed_at ? <em> {R.hidden}</em> : <> <button type="button" className="secondary" disabled={busy} onClick={() => hide(r.id)}>{R.hide}</button></>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
