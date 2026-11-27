'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';

const E = s.admin.errors;
const when = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// What broke on people's phones. One line per kind of error, with a count. Mark one fixed once you have dealt with it;
// if it is seen again later, it comes back by itself.
export default function AdminErrors({ rows, missing, onChanged }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  async function mark(id, fixed) {
    setBusy(id); setMsg('');
    const { error } = await supabase.rpc('admin_resolve_error', { p_id: id, p_fixed: fixed });
    setBusy('');
    if (error) setMsg(s.failed); else await onChanged();
  }
  return (
    <section>
      <h2>{E.title}</h2>
      <p className="hint">{E.intro}</p>
      {missing && <p className="warn">{E.missing}</p>}
      {!missing && rows.length === 0 && <p>{E.none}</p>}
      {msg && <p role="status"><strong>{msg}</strong></p>}
      <ul className="cards">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="admin-card">
              <summary>
                <span className="chip">{E.kinds[r.kind] ?? r.kind}</span>{' '}
                <strong className="errmsg">{r.message}</strong>
                <span className="hint"> · {E.times(r.count)} · {when(r.last_seen)}{r.resolved_at ? ` · ${E.fixed}` : ''}</span>
              </summary>
              <div className="admin-body">
                <p className="hint">{E.where}: <code>{r.path || '/'}</code> · {E.first}: {when(r.first_seen)}</p>
                {r.agent && <p className="hint">{E.device}: {r.agent}</p>}
                {r.stack && <pre className="errstack">{r.stack}</pre>}
                <p>
                  {r.resolved_at
                    ? <button type="button" className="secondary" disabled={busy === r.id} onClick={() => mark(r.id, false)}>{E.reopen}</button>
                    : <button type="button" disabled={busy === r.id} onClick={() => mark(r.id, true)}>{E.markFixed}</button>}
                </p>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
