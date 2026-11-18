'use client';
// Moderator side: record what an office told us. Shown inside the case panel in /admin.
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { addReply, hideReply, loadAdminReplies, MAX_LEN } from '@/lib/officeReplies';
import { replyMissing } from '@/lib/formRules';
import { Req } from '@/components/Req';
import '@/components/forms.css';

const R = s.admin.replies;
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminReplyForm({ issueId, hasParty }) {
  const [list, setList] = useState([]);
  const [kind, setKind] = useState('reply');
  const [body, setBody] = useState('');
  const [expected, setExpected] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false); // pressed Publish with something missing
  const [attempt, setAttempt] = useState(0);
  const box = useRef(null);

  const load = useCallback(() => loadAdminReplies(supabase, issueId).then(setList), [issueId]);
  useEffect(() => { load(); }, [load]);

  const miss = replyMissing(kind, { body, expected });
  const bad = (k) => tried && miss.includes(k);
  const invalid = (k) => (bad(k) ? 'true' : undefined);
  const why = (k) => (bad(k) ? `err-${k}` : undefined);
  const fix = (k) => bad(k) && <span id={`err-${k}`} className="fielderr">{s.req.reply[k]}</span>;
  useEffect(() => {
    if (attempt) box.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  async function submit() {
    if (miss.length) { setTried(true); setAttempt((n) => n + 1); setMsg(''); return; }
    setBusy(true); setMsg('');
    const r = await addReply(supabase, issueId, { kind, body, expected }, today());
    if (r.error) setMsg(R.errors[r.error] ?? R.errors.failed);
    else { setBody(''); setExpected(''); setTried(false); setMsg(R.saved); await load(); }
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
        <div ref={box} className="stack">
          <p className="hint reqnote"><span className="req" aria-hidden="true">*</span> {s.req.note}</p>
          <label><span>{R.kind}</span>
            <select value={kind} onChange={(e) => { setKind(e.target.value); setTried(false); }}>
              <option value="reply">{R.reply}</option>
              <option value="expected_date">{R.expected}</option>
              <option value="not_ours">{R.notOurs}</option>
            </select>
          </label>
          {kind === 'expected_date' && (
            <label><span>{R.date}<Req /></span>
              <input type="date" value={expected} min={today()} onChange={(e) => setExpected(e.target.value)} aria-required="true" aria-invalid={invalid('date')} aria-describedby={why('date')} />
              {fix('date')}
            </label>
          )}
          <label><span>{R.text}{kind !== 'expected_date' && <Req />}</span>
            <textarea rows={3} maxLength={MAX_LEN} value={body} onChange={(e) => setBody(e.target.value)} aria-required={kind !== 'expected_date' || undefined} aria-invalid={invalid('text')} aria-describedby={why('text')} />
            {fix('text')}
          </label>
          <p><button type="button" disabled={busy} onClick={submit}>{R.add}</button></p>
        </div>
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
