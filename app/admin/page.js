'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import AdminIssue from '@/components/AdminIssue';
import AdminSuggestion from '@/components/AdminSuggestion';

const A = s.admin;
const RANK = { hazard: 0, high: 1, medium: 2, low: 3 };
const VIEWS = {
  needs: (i) => ['reported', 'verified'].includes(i.status),
  active: (i) => ['sent', 'in_progress'].includes(i.status),
  flagged: (i) => i.flag_count > 0 && i.status !== 'rejected',
  resolved: (i) => i.status === 'resolved',
  rejected: (i) => i.status === 'rejected',
};

function SignIn() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  async function send(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    setMsg(error ? `Could not send the link: ${error.message}` : A.linkSent);
  }
  return (
    <form className="panel" onSubmit={send}>
      <p>{A.signInIntro}</p>
      <label>{A.email}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit">{A.sendLink}</button>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </form>
  );
}

function AddParty({ regions, onSaved }) {
  const [f, setF] = useState({ name: '', type: 'government', region: '', email: '', phone: '', whatsapp: '' });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));

  async function save(e) {
    e.preventDefault();
    const { error } = await supabase.rpc('admin_add_party', {
      p_name: f.name.trim(), p_type: f.type, p_region: f.region || null,
      p_email: f.email.trim(), p_phone: f.phone.trim(), p_whatsapp: f.whatsapp.trim(),
    });
    if (error) return setMsg(s.failed);
    setMsg(A.partySaved);
    setF({ name: '', type: 'government', region: '', email: '', phone: '', whatsapp: '' });
    onSaved();
  }

  return (
    <details className="admin-card">
      <summary><strong>{A.addParty}</strong></summary>
      <form className="panel admin-body" onSubmit={save}>
        <label>{A.name}<input type="text" value={f.name} onChange={set('name')} required /></label>
        <label>{A.type}
          <select value={f.type} onChange={set('type')}>
            {Object.entries(A.typeOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{A.area}
          <select value={f.region} onChange={set('region')}>
            <option value="">{s.choose}</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.level === 'city' && byId[r.parent_id] ? `${r.name}, ${byId[r.parent_id].name}` : r.name}
              </option>
            ))}
          </select>
        </label>
        <label>{A.email}<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>{A.phone}<input type="text" inputMode="tel" value={f.phone} onChange={set('phone')} /></label>
        <label>{A.whatsappNumber}<input type="text" inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} /></label>
        <button type="submit">{A.saveParty}</button>
        {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
      </form>
    </details>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [role, setRole] = useState('checking');       // checking | no | yes
  const [issues, setIssues] = useState([]);
  const [cats, setCats] = useState([]);
  const [parties, setParties] = useState([]);
  const [links, setLinks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [regions, setRegions] = useState([]);
  const [view, setView] = useState('needs');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signedIn = session && !session.user.is_anonymous;

  const refresh = useCallback(async () => {
    const [i, c, p, r, l, sg] = await Promise.all([
      supabase.rpc('admin_list_issues'),
      supabase.from('categories').select('id, name'),
      supabase.from('responsible_parties').select('id, name').eq('verified', true).order('name'),
      supabase.from('regions').select('id, name, level, parent_id').in('level', ['region', 'city']).order('name'),
      supabase.from('issue_links').select('issue_a, issue_b, relation'),
      supabase.rpc('admin_list_suggestions'),   // empty until 008 has been run
    ]);
    setIssues(i.data ?? []); setCats(c.data ?? []); setParties(p.data ?? []); setRegions(r.data ?? []); setLinks(l.data ?? []); setSuggestions(Array.isArray(sg.data) ? sg.data : []);
  }, []);

  useEffect(() => {
    if (!signedIn) { setRole('checking'); return; }
    supabase.rpc('is_moderator').then(({ data }) => {
      setRole(data === true ? 'yes' : 'no');
      if (data === true) refresh();
    });
  }, [signedIn, refresh]);

  const regionName = useMemo(() => {
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    return (id) => { const r = byId[id]; return r ? (r.level === 'city' && byId[r.parent_id] ? `${r.name}, ${byId[r.parent_id].name}` : r.name) : ''; };
  }, [regions]);
  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, label(c.name)])), [cats]);
  const counts = useMemo(
    () => ({ ...Object.fromEntries(Object.entries(VIEWS).map(([k, fn]) => [k, issues.filter(fn).length])), directory: suggestions.length }),
    [issues, suggestions]
  );
  const shown = useMemo(
    () =>
      (VIEWS[view] ? issues.filter(VIEWS[view]) : []).sort(
        (a, b) =>
          RANK[a.severity] - RANK[b.severity] ||
          b.confirmation_count - a.confirmation_count ||
          new Date(a.created_at) - new Date(b.created_at)
      ),
    [issues, view]
  );

  return (
    <main className="wrap wide">
      <h1 className="page-title">{A.title}</h1>

      {session === undefined && <p className="hint">{s.loading}</p>}
      {session !== undefined && !signedIn && <SignIn />}
      {signedIn && role === 'checking' && <p className="hint">{s.loading}</p>}

      {signedIn && role === 'no' && (
        <>
          <p>{A.notModerator}</p>
          <button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>{A.signOut}</button>
        </>
      )}

      {signedIn && role === 'yes' && (
        <>
          <div className="tabs" role="tablist">
            {[...Object.keys(VIEWS), 'directory'].map((k) => (
              <button key={k} type="button" role="tab" aria-selected={view === k}
                className={view === k ? 'tab on' : 'tab'} onClick={() => setView(k)}>
                {A.views[k]} ({counts[k]})
              </button>
            ))}
          </div>

          {view === 'directory' ? (
            <>
              {suggestions.length === 0 && <p>{A.directory.none}</p>}
              <ul className="cards">
                {suggestions.map((x) => (
                  <AdminSuggestion key={x.id} item={x} catName={catName} regionName={regionName} onChanged={refresh} />
                ))}
              </ul>
            </>
          ) : (
            <>
          {shown.length === 0 && <p>{A.none}</p>}
          <ul className="cards">
            {shown.map((i) => (
              <AdminIssue key={i.id} issue={i} categoryName={catName[i.category_id] ?? ''} categoryNames={catName} parties={parties} allIssues={issues} links={links} onChanged={refresh} />
            ))}
          </ul>
            </>
          )}

          <h2>{A.addParty}</h2>
          <AddParty regions={regions} onSaved={refresh} />
          <p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>{A.signOut}</button></p>
        </>
      )}
    </main>
  );
}

