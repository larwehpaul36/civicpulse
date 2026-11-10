'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { loadFixCheck, sendFixCheck } from '@/lib/fixCheck';
import { strings as s } from '@/lib/strings';

const F = s.fixCheck;

// Shown on a resolved report. Everyone sees the totals; only the reporter and people who confirmed it get the buttons.
export default function FixCheck({ issueId, onReopened }) {
  const [state, setState] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setState(await loadFixCheck(supabase, issueId)); } catch (e) { console.error(e); setState(null); }
  }, [issueId]);
  useEffect(() => { load(); }, [load]);

  async function answer(a) {
    setBusy(true); setMsg('');
    try {
      const r = await sendFixCheck(supabase, issueId, a);
      if (r.error) { setMsg(F.errors[r.error] ?? F.errors.failed); return; }
      if (r.reopened) { setMsg(F.reopened); onReopened?.(); return; }
      setMsg(F.thanks);
      await load();
    } finally { setBusy(false); }
  }

  if (!state) return null;
  const any = state.fixed + state.partly + state.notFixed > 0;
  if (!state.eligible && !any && !state.reopened) return null;
  return (
    <section className="panel">
      <h2>{F.title}</h2>
      {state.reopened > 0 && <p className="warn">{F.wasReopened(state.reopened)}</p>}
      {state.eligible && (
        <>
          <p>{F.ask}</p>
          <div className="tabs" role="group" aria-label={F.title}>
            {['fixed', 'partly', 'not_fixed'].map((a) => (
              <button key={a} type="button" className={`tab${state.answer === a ? ' on' : ''}`} aria-pressed={state.answer === a} disabled={busy} onClick={() => answer(a)}>{F.options[a]}</button>
            ))}
          </div>
          <p className="hint">{F.rule}</p>
        </>
      )}
      {any && <p className="hint">{F.totals(state.fixed, state.partly, state.notFixed)}</p>}
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </section>
  );
}
