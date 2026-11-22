'use client';
// The page an office opens from the private link in a CivicPulse message. No sign-in. See migration 025.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { MAX_LEN } from '@/lib/officeReplies';
import { loadLinkInfo, replyViaLink } from '@/lib/replyLinks';
import { replyMissing } from '@/lib/formRules';
import { Req } from '@/components/Req';
import '@/components/forms.css';

const T = s.officeLink;
const today = () => new Date().toISOString().slice(0, 10);

export default function OfficeReplyPage() {
  const { token } = useParams();
  const [state, setState] = useState({ phase: 'loading' }); // loading | bad | failed | ready | done
  const [catName, setCatName] = useState('');
  const [kind, setKind] = useState('reply');
  const [body, setBody] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await loadLinkInfo(supabase, token);
      if (dead) return;
      if (r.error) return setState({ phase: r.error === 'link_invalid' ? 'bad' : 'failed' });
      setState({ phase: 'ready', info: r.info });
      try {
        const { data } = await supabase.from('categories').select('id, name').eq('id', r.info.category_id);
        if (!dead && data?.[0]) setCatName(label(data[0].name));
      } catch { /* the title is a nicety */ }
    })();
    return () => { dead = true; };
  }, [token]);

  const miss = replyMissing(kind, { body, expected });
  const bad = (k) => tried && miss.includes(k);
  const invalid = (k) => (bad(k) ? 'true' : undefined);
  const why = (k) => (bad(k) ? `err-${k}` : undefined);
  const fix = (k) => bad(k) && <span id={`err-${k}`} className="fielderr">{s.req.reply[k]}</span>;
  useEffect(() => { if (attempt) box.current?.querySelector('[aria-invalid="true"]')?.focus(); }, [attempt]);

  async function send(e) {
    e.preventDefault();
    if (miss.length) { setTried(true); setAttempt((n) => n + 1); setError(''); return; }
    setBusy(true); setError('');
    const r = await replyViaLink(supabase, token, { kind, body, expected }, today());
    setBusy(false);
    if (r.error === 'link_invalid') return setState({ phase: 'bad' });
    if (r.error) return setError(T.errors[r.error] ?? T.errors.failed);
    setState((p) => ({ ...p, phase: 'done' }));
  }
  function again() { setBody(''); setExpected(''); setKind('reply'); setTried(false); setError(''); setState((p) => ({ ...p, phase: 'ready' })); }

  if (state.phase === 'loading') return <main className="wrap"><h1 className="page-title">{T.title}</h1><p className="hint">{T.loading}</p></main>;
  if (state.phase === 'bad') return <main className="wrap"><h1 className="page-title">{T.title}</h1><p role="alert">{T.bad}</p></main>;
  if (state.phase === 'failed') return <main className="wrap"><h1 className="page-title">{T.title}</h1><p role="alert">{T.failed}</p></main>;

  const info = state.info;
  const reportHref = `/issues/${info.issue_id}`;
  if (state.phase === 'done')
    return (
      <main className="wrap">
        <h1 className="page-title">{T.thanksTitle}</h1>
        <p>{T.thanks}</p>
        <p><Link href={reportHref} target="_blank" rel="noopener">{T.open}</Link></p>
        <p><button type="button" className="secondary" onClick={again}>{T.another}</button></p>
      </main>
    );

  return (
    <main className="wrap">
      <h1 className="page-title">{T.title}</h1>
      <p>{T.intro(info.party_name)}</p>
      <section className="card" aria-label={T.caseTitle}>
        {catName && <p><strong>{catName}</strong></p>}
        {info.description && <p>{info.description}</p>}
        <p className="hint">{T.status}: {s.statusLabels[info.status] ?? info.status}</p>
        <p><Link href={reportHref} target="_blank" rel="noopener">{T.open}</Link></p>
      </section>

      <form ref={box} className="panel stack" noValidate onSubmit={send}>
        <p className="hint reqnote"><span className="req" aria-hidden="true">*</span> {s.req.note}</p>
        <fieldset className="panel">
          <legend>{T.kindLabel}</legend>
          {Object.entries(T.kinds).map(([k, v]) => (
            <label key={k} className="check">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => { setKind(k); setTried(false); setError(''); }} /> {v}
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
        <button type="submit" disabled={busy}>{busy ? T.sending : T.send}</button>
        <p className="hint">{T.publicNote}</p>
        <p className="hint">{T.secretNote}</p>
      </form>
    </main>
  );
}
