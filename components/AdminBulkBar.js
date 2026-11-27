'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { filterOffices } from '@/lib/places';
import { strings as s } from '@/lib/strings';
import { BULK_STATUSES, NEEDS_CONFIRM, bulkErrorKey, failureCounts, summarize } from '@/lib/moderatorTools';

const B = s.admin.bulk;

// The bar that appears when at least one report is ticked. One action at a time, confirmed before it runs,
// and the answer says exactly which reports failed and why. Failed ones stay ticked so they can be fixed and retried.
export default function AdminBulkBar({ ids, parties, onClear, onKeep, onChanged }) {
  const [action, setAction] = useState('');
  const [officeQ, setOfficeQ] = useState('');
  const [party, setParty] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [why, setWhy] = useState([]);

  const found = filterOffices(parties, officeQ);
  const needsOffice = action === 'assign';
  const ready = action && (!needsOffice || party);
  const confirmKey = action.startsWith('status:') ? action.slice(7) : action;

  function pick(e) { setAction(e.target.value); setArmed(false); setMsg(''); setWhy([]); }
  function typeOffice(e) {
    const q = e.target.value; setOfficeQ(q); setArmed(false);
    const hits = filterOffices(parties, q);
    if (q.trim() && hits.length === 1) setParty(hits[0].id);
  }

  async function apply() {
    if (!ready || busy) return;
    if (!armed && NEEDS_CONFIRM.has(confirmKey)) { setArmed(true); return; }
    setBusy(true); setMsg(''); setWhy([]); setArmed(false);
    try {
      let call;
      if (action.startsWith('status:')) call = supabase.rpc('admin_bulk_set_status', { p_ids: ids, p_status: action.slice(7), p_note: null });
      else if (action === 'assign') call = supabase.rpc('admin_bulk_assign_party', { p_ids: ids, p_party: party });
      else call = supabase.rpc('admin_bulk_dismiss_flags', { p_ids: ids });
      const { data, error } = await call;
      if (error) throw error;
      const r = summarize(data);
      setMsg(B.result(r.done, r.total));
      const counts = failureCounts(r.failed);
      setWhy(Object.entries(counts).map(([k, n]) => B.why[k](n)).concat(r.failed.length ? [B.stays] : []));
      onKeep(r.failed.map((f) => f.id));       // only the failed ones stay ticked
      await onChanged();
      if (!r.failed.length) { setAction(''); setParty(''); setOfficeQ(''); }
    } catch (e) {
      console.error(e);
      setMsg(B.errors[bulkErrorKey(e)]);
    } finally { setBusy(false); }
  }

  return (
    <section className="bulkbar" aria-label={B.actions}>
      <p className="bulk-count"><strong aria-live="polite">{B.selected(ids.length)}</strong>{' '}
        <button type="button" className="linkish" onClick={onClear}>{B.clear}</button></p>
      <label>{B.actions}
        <select value={action} onChange={pick} disabled={busy}>
          <option value="">{B.pick}</option>
          {BULK_STATUSES.map((k) => <option key={k} value={`status:${k}`}>{B.status[k]}</option>)}
          <option value="assign">{B.assign}</option>
          <option value="dismiss">{B.dismiss}</option>
        </select>
      </label>
      {needsOffice && (
        <>
          <label>{B.searchOffice}
            <input type="search" value={officeQ} onChange={typeOffice} disabled={busy} />
          </label>
          <label>{B.assignTo}
            <select value={party} onChange={(e) => { setParty(e.target.value); setArmed(false); }} disabled={busy}>
              <option value="">{B.chooseOffice}</option>
              {found.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </>
      )}
      <p className="cta-row">
        <button type="button" disabled={!ready || busy} onClick={apply}>
          {busy ? B.working : armed ? B.confirm(ids.length) : B.run}
        </button>
        {armed && <button type="button" className="secondary" onClick={() => setArmed(false)}>{B.cancel}</button>}
      </p>
      {msg && <p role="status"><strong>{msg}</strong></p>}
      {why.length > 0 && <ul className="bulk-why">{why.map((w) => <li key={w}>{w}</li>)}</ul>}
    </section>
  );
}
