'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase, ensureUser } from '@/lib/supabase';
import { getCaptchaToken } from '@/lib/captcha';
import { disablePush } from '@/lib/notifications';
import { EMAIL_ACCOUNTS, accountState, addEmailOrSignIn, requestSignIn, signOutHere } from '@/lib/emailAccount';
import { claimPending, prepareMerge } from '@/lib/mergeTicket';
import { strings as s } from '@/lib/strings';
import { emailProblem } from '@/lib/formRules';
import '@/components/forms.css';

const A = s.account;
const errorText = (err) => ({ bad_email: A.bad, too_soon: A.tooSoon, email_off: A.off, prepare_failed: A.prepareFailed }[err?.message] ?? A.failed);
const backHere = () => `${window.location.origin}/my`; // must be in Supabase's Redirect URLs (docs/email-signin-setup.md)

// The address a link was last asked for, kept on this phone so the "waiting for your link" line looks the same whether or
// not that address already had an account (the server's pending address would show the difference).
const ASKED = 'civicpulse.linkAsked';
const askedGet = () => { try { return window.localStorage.getItem(ASKED) || ''; } catch { return ''; } };
const askedSet = (v) => { try { if (v) window.localStorage.setItem(ASKED, v); else window.localStorage.removeItem(ASKED); } catch { /* optional */ } };

// "Keep your reports if you change phone": optional email on the same account. Hidden until NEXT_PUBLIC_EMAIL_ACCOUNTS=1.
export default function KeepAccount({ hasReports = false, onMerged }) {
  const [user, setUser] = useState(undefined); // undefined = still loading, null = no account yet
  const [email, setEmail] = useState('');
  const [signInEmail, setSignInEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [signInMsg, setSignInMsg] = useState('');
  const [asked, setAsked] = useState('');
  const [triedAdd, setTriedAdd] = useState(false); // pressed the button with the box empty or wrong
  const [triedIn, setTriedIn] = useState(false);
  const addRef = useRef(null);
  const inRef = useRef(null);
  const emailText = (p) => (p === 'empty' ? s.req.email : p === 'bad' ? s.req.emailBad : null);
  const addText = triedAdd ? emailText(emailProblem(email)) : null;
  const inText = triedIn ? emailText(emailProblem(signInEmail)) : null;
  const claiming = useRef(false);

  useEffect(() => { setAsked(askedGet()); }, []);

  useEffect(() => {
    if (!EMAIL_ACCOUNTS) return undefined;
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      setUser(session?.user ?? null);
      if (session) { // the saved copy can miss a pending address, so ask the server too (offline: keep what we have)
        const { data } = await supabase.auth.getUser();
        if (alive && data?.user) setUser(data.user);
      }
    })().catch(() => { if (alive) setUser((u) => (u === undefined ? null : u)); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (alive) setUser(session?.user ?? null); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  // Once signed in to an account with a confirmed email, hand over any ticket made on this phone (see lib/mergeTicket.js).
  const signedEmail = user && user.email && user.email_confirmed_at ? user.email : '';
  useEffect(() => {
    if (!EMAIL_ACCOUNTS || !signedEmail || claiming.current) return;
    claiming.current = true;
    askedSet(''); setAsked('');
    claimPending({ supabase }, signedEmail)
      .then((r) => { if (r?.moved) { setMsg(A.merged(r.moved)); onMerged?.(r.moved); } })
      .catch((err) => console.error(err))
      .finally(() => { claiming.current = false; });
  }, [signedEmail]); // runs once per sign-in; the other values it reads are stable

  if (!EMAIL_ACCOUNTS || user === undefined) return null;
  const state = accountState(user);
  const prepare = (address) => prepareMerge({ supabase }, address).catch((err) => { if (hasReports) throw err; });

  async function addEmail(e) {
    e.preventDefault();
    if (emailProblem(email)) { setTriedAdd(true); setMsg(''); addRef.current?.focus(); return; }
    setBusy('add'); setMsg('');
    try {
      const sent = await addEmailOrSignIn({ supabase, ensureUser, getCaptchaToken, prepare }, email, backHere());
      setMsg(A.sentTo(sent));
      askedSet(sent); setAsked(sent);
      setEmail(''); setTriedAdd(false);
      const { data } = await supabase.auth.getUser().catch(() => ({ data: null }));
      if (data?.user) setUser(data.user);
    } catch (err) { console.error(err); setMsg(errorText(err)); }
    finally { setBusy(''); }
  }

  async function signIn(e) {
    e.preventDefault();
    if (emailProblem(signInEmail)) { setTriedIn(true); setSignInMsg(''); inRef.current?.focus(); return; }
    setBusy('signin'); setSignInMsg('');
    try {
      await prepare(signInEmail.trim().toLowerCase());
      const sent = await requestSignIn({ supabase, getCaptchaToken }, signInEmail, backHere());
      setSignInMsg(A.signInSent(sent)); setSignInEmail(''); setTriedIn(false); askedSet(sent); setAsked(sent);
    }
    catch (err) { console.error(err); setSignInMsg(errorText(err)); }
    finally { setBusy(''); }
  }

  async function signOut() {
    setBusy('out'); setMsg('');
    try {
      await disablePush().catch(() => {}); // this phone should stop getting this account's alerts
      await signOutHere(supabase);
      setMsg(A.signedOut);
    } catch (err) { console.error(err); setMsg(A.failed); }
    finally { setBusy(''); }
  }

  return (
    <section className="panel">
      <h2>{A.title}</h2>
      {state.kind === 'signedIn' ? (
        <>
          <p><strong>{A.signedIn(state.email)}</strong></p>
          <p className="hint">{A.signedInHint}</p>
          <button type="button" className="secondary" disabled={busy === 'out'} onClick={signOut}>{A.signOut}</button>
        </>
      ) : (
        <>
          <p>{A.explain}</p>
          {asked && <p><strong>{A.pending(asked)}</strong></p>}
          <form className="panel" onSubmit={addEmail} noValidate>
            <label><span>{A.address}</span>
              <input ref={addRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={addText ? 'true' : undefined} aria-describedby={addText ? 'err-add-email' : undefined} />
              {addText && <span id="err-add-email" className="fielderr">{addText}</span>}
            </label>
            <p className="hint">{A.privacy}</p>
            <button type="submit" disabled={busy === 'add'}>{A.send}</button>
          </form>
          <details>
            <summary>{A.haveOne}</summary>
            <form className="panel" onSubmit={signIn} noValidate>
              <p>{A.signInIntro}</p>
              {hasReports && <p className="warn">{A.switchWarning}</p>}
              <label><span>{A.address}</span>
                <input ref={inRef} type="email" value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} autoComplete="email" aria-invalid={inText ? 'true' : undefined} aria-describedby={inText ? 'err-signin-email' : undefined} />
                {inText && <span id="err-signin-email" className="fielderr">{inText}</span>}
              </label>
              <button type="submit" className="secondary" disabled={busy === 'signin'}>{A.signInSend}</button>
            </form>
            {signInMsg && <p aria-live="polite"><strong>{signInMsg}</strong></p>}
          </details>
        </>
      )}
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </section>
  );
}
