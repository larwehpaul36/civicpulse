'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase, ensureUser } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import ShareButton from '@/components/ShareButton';
import { useVerify } from '@/components/PhoneVerify';
import { needsPhone } from '@/lib/verifyFlow';
import { categoryTitle } from '@/lib/categoryTitle';

const photoUrl = (path) => supabase.storage.from('issue-photos').getPublicUrl(path).data.publicUrl;
const dateText = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function IssuePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const ask = useVerify();

  const load = useCallback(async () => {
    const [i, ph, log, contacts, cats] = await Promise.all([
      supabase.from('public_issues').select('*').eq('id', id).maybeSingle(),
      supabase.from('issue_photos').select('kind, storage_path').eq('issue_id', id),
      supabase.from('status_log').select('to_status, created_at').eq('issue_id', id).order('created_at'),
      supabase.from('contact_attempts').select('channel, response_received, created_at').eq('issue_id', id).order('created_at'),
      supabase.from('categories').select('id, name'),
    ]);
    const issue = i.data;
    let party = null;
    if (issue?.party_id) {
      party = (await supabase.from('responsible_parties').select('name').eq('id', issue.party_id).maybeSingle()).data;
    }
    // Links are stored once per pair, so look in both columns. public_issues hides anything not public.
    const [fromA, fromB] = await Promise.all([
      supabase.from('issue_links').select('issue_b, relation').eq('issue_a', id),
      supabase.from('issue_links').select('issue_a, relation').eq('issue_b', id),
    ]);
    const pairs = [
      ...(fromA.data ?? []).map((r) => ({ id: r.issue_b, relation: r.relation })),
      ...(fromB.data ?? []).map((r) => ({ id: r.issue_a, relation: r.relation })),
    ];
    let related = [];
    if (issue && pairs.length) {
      const { data: rows } = await supabase.from('public_issues')
        .select('id, category_id, status, description, days_open, other_label').in('id', pairs.map((p) => p.id));
      related = (rows ?? []).map((r) => ({ ...r, relation: pairs.find((p) => p.id === r.id)?.relation }));
    }
    setData({ issue, photos: ph.data ?? [], log: log.data ?? [], contacts: contacts.data ?? [], cats: cats.data ?? [], party, related });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function confirm(retried = false) {
    try {
      const user = await ensureUser();
      const { error } = await supabase.from('confirmations').insert({ issue_id: id, user_id: user.id });
      if (error && needsPhone(error) && !retried) {
        if (await ask()) return confirm(true); // phone confirmed: try once more
        return setMsg(s.verify.cancelled);
      }
      if (error) return setMsg(error.code === '23505' ? s.seeThanks : error.code === '42501' ? s.ownReport : s.failed);
      setMsg(s.seeThanks);
      load();
    } catch { setMsg(s.failed); }
  }

  async function flag() {
    try {
      const user = await ensureUser();
      const { error } = await supabase.from('flags').insert({ issue_id: id, user_id: user.id, reason: 'false_or_spam' });
      setMsg(error && error.code !== '23505' ? s.failed : s.flagged);
    } catch { setMsg(s.failed); }
  }

  if (!data) return <main className="wrap"><p className="hint">{s.loading}</p></main>;
  if (!data.issue)
    return (
      <main className="wrap">
        <p>{s.notFound}</p>
        <Link href="/issues">{s.back}</Link>
      </main>
    );

  const { issue, photos, log, contacts, cats, party, related } = data;
  const cat = cats.find((c) => c.id === issue.category_id);
  const before = photos.find((p) => p.kind === 'before');
  const after = photos.find((p) => p.kind === 'after');
  const waiting = issue.sent_at && !issue.resolved_at
    ? Math.floor((Date.now() - new Date(issue.sent_at)) / 86400000) : null;

  return (
    <main className="wrap">
      <p><Link href="/issues">{s.back}</Link></p>
      <h1 className="page-title">{categoryTitle(label(cat?.name), issue.other_label)}</h1>
      <p><span className="chip">{s.statusLabels[issue.status]}</span></p>
      <p>{issue.description || '—'}</p>
      <p className="hint">{s.daysOpen(issue.days_open)} · {s.confirmations(issue.confirmation_count)}</p>
      <p><strong>{s.responsibleParty}:</strong> {party?.name ?? s.notAssigned}</p>
      {waiting !== null && <p className="warn">{s.sentAgo(waiting)}</p>}
      <ShareButton title={categoryTitle(label(cat?.name), issue.other_label)} text={s.share.line(categoryTitle(label(cat?.name), issue.other_label), issue.status, issue.days_open)} />

      <div className="photos">
        <figure>
          <figcaption>{s.before}</figcaption>
          {before ? <img src={photoUrl(before.storage_path)} alt={s.a11y.beforePhoto} /> : <div className="empty" />}
        </figure>
        <figure>
          <figcaption>{s.after}</figcaption>
          {after ? <img src={photoUrl(after.storage_path)} alt={s.a11y.afterPhoto} /> : <div className="empty">{s.noAfter}</div>}
        </figure>
      </div>

      {issue.status !== 'resolved' && (
        <p><button type="button" onClick={() => confirm()}>{s.iSeeThis}</button></p>
      )}
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}

      {related.length > 0 && (
        <>
          <h2>{s.related.title}</h2>
          <ul className="cards">
            {related.map((r) => (
              <li key={r.id}>
                <Link href={`/issues/${r.id}`}>
                  <span className="chip">{s.statusLabels[r.status]}</span>
                  <strong>{categoryTitle(label(cats.find((c) => c.id === r.category_id)?.name), r.other_label)}</strong>
                  <span className="hint">{r.relation === 'duplicate' ? s.related.duplicate : s.related.related} · {s.daysOpen(r.days_open)}</span>
                  {r.description && <span>{r.description.slice(0, 100)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{s.history}</h2>
      <ul className="timeline">
        {log.map((l, n) => <li key={n}>{dateText(l.created_at)}: {s.statusLabels[l.to_status]}</li>)}
      </ul>

      <h2>{s.contactLog}</h2>
      {contacts.length === 0 ? <p className="hint">{s.noContact}</p> : (
        <ul className="timeline">
          {contacts.map((c, n) => (
            <li key={n}>{dateText(c.created_at)}: {c.channel} · {c.response_received ? s.responseYes : s.responseNo}</li>
          ))}
        </ul>
      )}

      <p><button type="button" className="secondary" onClick={flag}>{s.flag}</button></p>
    </main>
  );
}
