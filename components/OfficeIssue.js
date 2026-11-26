'use client';
// One report on the office page: what it is, where it is, what has been said, and the reply form.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { categoryTitle } from '@/lib/categoryTitle';
import { coordsText, googleMapsUrl, osmUrl } from '@/lib/mapLinks';
import { addStaffReply, daysWaiting, isOpen, needsReply } from '@/lib/officeStaff';
import { latestExpectedDate, loadReplies, MAX_LEN } from '@/lib/officeReplies';
import { replyMissing } from '@/lib/formRules';
import { Req } from '@/components/Req';
import '@/components/forms.css';

const T = s.office;
const photoUrl = (path) => supabase.storage.from('issue-photos').getPublicUrl(path).data.publicUrl;
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function OfficeIssue({ issue: i, categoryName, onChanged }) {
  const [replies, setReplies] = useState(null);
  const [kind, setKind] = useState('reply');
  const [body, setBody] = useState('');
  const [expected, setExpected] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  const box = useRef(null);

  // The thread loads when the card is opened, not for every card on the page.
  useEffect(() => {
    if (!opened) return undefined;
    let dead = false;
    loadReplies(supabase, i.id).then((r) => { if (!dead) setReplies(r); });
    return () => { dead = true; };
  }, [opened, i.id, i.replies_count]);

  const miss = replyMissing(kind, { body, expected });
  const bad = (k) => tried && miss.includes(k);
  const invalid = (k) => (bad(k) ? 'true' : undefined);
  const why = (k) => (bad(k) ? `err-${k}` : undefined);
  const fix = (k) => bad(k) && <span id={`err-${k}`} className="fielderr">{s.req.reply[k]}</span>;
  useEffect(() => { if (attempt) box.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [attempt]);

  async function send(e) {
    e.preventDefault();
    if (miss.length) { setTried(true); setAttempt((n) => n + 1); setError(''); setMsg(''); return; }
    setBusy(true); setError(''); setMsg('');
    const r = await addStaffReply(supabase, i.id, { kind, body, expected }, today());
    setBusy(false);
    if (r.error) return setError(T.errors[r.error] ?? T.errors.failed);
    setBody(''); setExpected(''); setKind('reply'); setTried(false); setMsg(T.saved);
    onChanged?.();
  }

  const title = categoryTitle(categoryName, i.other_label);
  const waiting = needsReply(i);
  const days = daysWaiting(i);
  const google = googleMapsUrl(i.lat, i.lng);
  const expectedDate = i.expected_date ?? latestExpectedDate(replies ?? []);

  return (
    <li>
      <details className="admin-card" onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
        <summary>
          <span className="chip">{s.statusLabels[i.status] ?? i.status}</span>{' '}
          <strong>{title}</strong>
          <span className="hint"> · {waiting ? <strong>{T.waitingFor(days)}</strong> : T.sentAgo(days)}{i.replies_count > 0 && <> · {T.repliesCount(i.replies_count)}</>}</span>
        </summary>
        <div className="panel admin-body">
          {i.description && <p>{i.description}</p>}
          <div className="photos">
            {i.before_path && <img src={photoUrl(i.before_path)} alt={s.a11y.beforePhoto} />}
            {i.after_path && <img src={photoUrl(i.after_path)} alt={s.a11y.afterPhoto} />}
          </div>
          <div className="maplinks">
            {google && <p className="hint">{T.coords}: <code>{coordsText(i.lat, i.lng)}</code></p>}
            <p className="cta-row">
              {google && <a className="cta" href={google} target="_blank" rel="noopener noreferrer">{s.admin.location.google}</a>}
              {google && <a className="cta ghost" href={osmUrl(i.lat, i.lng)} target="_blank" rel="noopener noreferrer">{s.admin.location.osm}</a>}
              <a className="cta ghost" href={`/issues/${i.id}`} target="_blank" rel="noopener noreferrer">{T.openPublic}</a>
            </p>
          </div>
          {expectedDate && <p className="hint">{T.expected(dateText(expectedDate))}</p>}

          <h3>{T.yourReplies}</h3>
          {replies === null ? <p className="hint">{s.loading}</p> : replies.length === 0 ? <p className="hint">{T.noReplies}</p> : (
            <ul className="timeline">
              {replies.map((r) => (
                <li key={r.id}>
                  {dateText(r.created_at)}: {r.kind === 'expected_date' && <strong>{s.replies.expected(dateText(r.expected_date))} </strong>}
                  {r.kind === 'not_ours' && <strong>{s.replies.notOurs}. </strong>}
                  {r.body && <span>“{r.body}”</span>}
                </li>
              ))}
            </ul>
          )}

          {!isOpen(i) ? <p className="hint">{T.resolvedNote}</p> : (
            <form ref={box} className="stack" noValidate onSubmit={send}>
              <p className="hint reqnote"><span className="req" aria-hidden="true">*</span> {s.req.note}</p>
              <fieldset className="panel">
                <legend>{T.kindLabel}</legend>
                {Object.entries(T.kinds).map(([k, v]) => (
                  <label key={k} className="check">
                    <input type="radio" name={`kind-${i.id}`} value={k} checked={kind === k} onChange={() => { setKind(k); setTried(false); setError(''); }} /> {v}
                  </label>
                ))}
              </fieldset>
              {kind === 'expected_date' && (
                <label><span>{T.date}<Req /></span>
                  <input type="date" value={expected} min={today()} onChange={(e) => setExpected(e.target.value)} aria-required="true" aria-invalid={invalid('date')} aria-describedby={why('date')} />
                  {fix('date')}
                </label>
              )}
              <label><span>{T.text}{kind !== 'expected_date' && <Req />}</span>
                <textarea rows={4} maxLength={MAX_LEN} value={body} onChange={(e) => setBody(e.target.value)} aria-required={kind !== 'expected_date' || undefined} aria-invalid={invalid('text')} aria-describedby={why('text')} />
                <span className="hint">{T.textHint}</span>
                {fix('text')}
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              {msg && <p role="status"><strong>{msg}</strong></p>}
              <button type="submit" disabled={busy}>{busy ? T.sending : T.send}</button>
              <p className="hint">{T.publicNote}</p>
            </form>
          )}
        </div>
      </details>
    </li>
  );
}
