'use client';
// The office page: invited staff of an assembly sign in with an email link, see the reports sent to their office, and reply. Migration 026.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCaptchaToken } from '@/lib/captcha';
import { label } from '@/lib/i18n';
import { strings as s } from '@/lib/strings';
import { loadMyOffices, loadOfficeIssues, OFFICE_VIEWS, sortForOffice, validEmail, normEmail } from '@/lib/officeStaff';
import OfficeIssue from '@/components/OfficeIssue';
import '@/components/forms.css';

const T = s.office;

function SignIn() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  async function send(e) {
    e.preventDefault();
    if (!validEmail(email)) return setMsg(s.admin.staff.errors.bad_email);
    let captchaToken;
    try { captchaToken = await getCaptchaToken(); } catch { return setMsg(s.captchaFailed); }
    const { error } = await supabase.auth.signInWithOtp({
      email: normEmail(email), options: { emailRedirectTo: `${window.location.origin}/office`, ...(captchaToken ? { captchaToken } : {}) },
    });
    setMsg(error ? `${T.errors.failed} (${error.message})` : T.linkSent);
  }
  return (
    <form className="panel" noValidate onSubmit={send}>
      <p>{T.intro}</p>
      <label>{T.email}
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit">{T.sendLink}</button>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </form>
  );
}

export default function OfficePage() {
  const [session, setSession] = useState(undefined);   // undefined = still loading
  const [offices, setOffices] = useState(null);         // null = checking
  const [issues, setIssues] = useState([]);
  const [cats, setCats] = useState([]);
  const [problem, setProblem] = useState(false);
  const [view, setView] = useState('waiting');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);
  const signedIn = session && !session.user.is_anonymous;

  const refresh = useCallback(async () => {
    const [r, c] = await Promise.all([loadOfficeIssues(supabase), supabase.from('categories').select('id, name')]);
    if (r.error) return setProblem(true);
    setProblem(false); setIssues(r.issues); setCats(c.data ?? []);
  }, []);

  useEffect(() => {
    if (!signedIn) { setOffices(null); return; }
    let dead = false;
    loadMyOffices(supabase).then((r) => {
      if (dead) return;
      if (r.error) { setProblem(true); setOffices([]); return; }
      setOffices(r.offices);
      if (r.offices.length) refresh();
    });
    return () => { dead = true; };
  }, [signedIn, refresh]);

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, label(c.name)])), [cats]);
  const counts = useMemo(() => Object.fromEntries(Object.entries(OFFICE_VIEWS).map(([k, fn]) => [k, issues.filter(fn).length])), [issues]);
  const shown = useMemo(() => sortForOffice(issues.filter(OFFICE_VIEWS[view])), [issues, view]);
  const signOut = <p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>{T.signOut}</button></p>;

  return (
    <main className="wrap wide">
      <h1 className="page-title">{T.title}</h1>
      {session === undefined && <p className="hint">{T.loading}</p>}
      {session !== undefined && !signedIn && <SignIn />}
      {signedIn && offices === null && <p className="hint">{T.loading}</p>}

      {signedIn && offices !== null && problem && offices.length === 0 && <><p role="alert">{T.failed}</p>{signOut}</>}
      {signedIn && offices !== null && !problem && offices.length === 0 && <><p role="alert">{T.notInvited}</p><p className="hint">{T.signedInAs(session.user.email)}</p>{signOut}</>}

      {signedIn && offices !== null && offices.length > 0 && (
        <>
          <h2>{T.forOffice(offices.map((o) => o.name).join(', '))}</h2>
          <p className="hint">{T.signedInAs(session.user.email)}</p>
          {problem && <p role="alert">{T.failed}</p>}
          <div className="tabs" role="tablist">
            {Object.keys(OFFICE_VIEWS).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'tab on' : 'tab'} onClick={() => setView(k)}>
                {T.views[k]} ({counts[k] ?? 0})
              </button>
            ))}
          </div>
          {shown.length === 0 && <p>{view === 'waiting' ? T.noneWaiting : T.none}</p>}
          <ul className="cards">
            {shown.map((i) => <OfficeIssue key={i.id} issue={i} categoryName={catName[i.category_id] ?? ''} onChanged={refresh} />)}
          </ul>
          {signOut}
        </>
      )}
    </main>
  );
}
