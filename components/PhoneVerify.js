'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { strings as s } from '@/lib/strings';
import { normalizeGhanaPhone, maskPhone } from '@/lib/phone';
import { requestCode, confirmCode } from '@/lib/verifyFlow';

const V = s.verify;
const BLANK = ['', '', '', '', '', ''];
const Ctx = createContext(async () => false);

// const ask = useVerify(); if (await ask()) { ...the phone is now confirmed... }
export const useVerify = () => useContext(Ctx);

export default function PhoneVerifyProvider({ children }) {
  const [open, setOpen] = useState(false);
  const resolver = useRef(null);
  const ask = useCallback(() => new Promise((resolve) => {
    resolver.current?.(false); // a newer request replaces an older one
    resolver.current = resolve;
    setOpen(true);
  }), []);
  const finish = useCallback((ok) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  }, []);
  return <Ctx.Provider value={ask}>{children}{open && <Sheet onDone={finish} />}</Ctx.Provider>;
}

function Sheet({ onDone }) {
  const [step, setStep] = useState('phone'); // phone, code, done
  const [raw, setRaw] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState('link');
  const [digits, setDigits] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [tries, setTries] = useState(3);
  const box = useRef(null);
  const inputs = useRef([]);

  // Focus moves into the sheet, Tab stays inside it, Escape closes it, and focus goes back afterwards.
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') return onDone(false);
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll('button:not([disabled]), input')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [onDone]);

  useEffect(() => {
    if (step === 'phone') box.current?.querySelector('#vphone')?.focus();
    if (step === 'code') inputs.current[0]?.focus();
    if (step === 'done') box.current?.querySelector('button')?.focus();
  }, [step]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(e) {
    e?.preventDefault();
    setError('');
    const p = normalizeGhanaPhone(raw);
    if (!p) return setError(V.badNumber);
    setBusy(true);
    const r = await requestCode(supabase, p);
    setBusy(false);
    if (r.error) return setError(V[r.error] ?? V.generic);
    setPhone(p); setMode(r.mode); setDigits(BLANK); setTries(3); setWait(60); setStep('code');
  }

  async function verify(code) {
    setBusy(true); setError('');
    const r = await confirmCode(supabase, { phone, token: code, mode });
    setBusy(false);
    if (r.error) {
      setDigits(BLANK);
      if (r.error === 'wrong') {
        const left = tries - 1;
        setTries(left);
        if (left <= 0) { setStep('phone'); setError(V.tooMany); return; }
        setError(V.wrong(left));
      } else setError(V[r.error] ?? V.generic);
      inputs.current[0]?.focus();
      return;
    }
    await supabase.auth.refreshSession().catch(() => {});
    setStep('done');
  }

  // Typing, pasting a code, or the phone's SMS autofill all arrive here.
  function onDigit(i, value) {
    const d = value.replace(/\D/g, '');
    if (!d) { setDigits((a) => a.map((x, k) => (k === i ? '' : x))); return; }
    const next = [...digits];
    d.slice(0, 6 - i).split('').forEach((c, k) => { next[i + k] = c; });
    setDigits(next);
    inputs.current[Math.min(i + d.length, 5)]?.focus();
    if (next.every(Boolean)) verify(next.join(''));
  }
  const onBack = (i, e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus(); };

  return (
    <>
      <button type="button" className="vscrim" tabIndex={-1} aria-label={V.notNow} onClick={() => !busy && onDone(step === 'done')} />
      <div className="vwrap">
        <section ref={box} className="vsheet" role="dialog" aria-modal="true" aria-labelledby="vtitle">
          <div className="vgrab" />
          {step === 'phone' && (
            <form onSubmit={send}>
              <div className="vic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg></div>
              <h2 id="vtitle">{V.title}</h2>
              <p>{V.intro}</p>
              <label htmlFor="vphone">{V.phoneLabel}</label>
              <div className="vphone">
                <span className="vcc">+233</span>
                <input id="vphone" type="tel" inputMode="tel" autoComplete="tel-national" value={raw} placeholder="24 000 0000" onChange={(e) => setRaw(e.target.value)} />
              </div>
              {error && <p className="error" role="alert">{error}</p>}
              <button type="submit" disabled={busy}>{V.send}</button>
              <button type="button" className="linkbtn" onClick={() => onDone(false)}>{V.notNow}</button>
              <p className="vfine">{V.fine} <a href="/privacy" target="_blank" rel="noopener noreferrer">{V.privacyLink}</a>.</p>
              <div className="vtrust">{V.trust.map((t) => <span key={t}>✓ {t}</span>)}</div>
            </form>
          )}
          {step === 'code' && (
            <div>
              <div className="vic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg></div>
              <h2 id="vtitle">{V.codeTitle}</h2>
              <p>{V.sentTo(maskPhone(phone))} <button type="button" className="linkbtn" style={{ display: 'inline', margin: 0, minHeight: 0 }} onClick={() => { setStep('phone'); setError(''); }}>{V.change}</button></p>
              <span className="label" id="codelbl" style={{ display: 'block', margin: '1rem 0 .5rem' }}>{V.codeLabel}</span>
              <div className={`otp${error ? ' bad' : ''}`} role="group" aria-labelledby="codelbl">
                {digits.map((d, i) => (
                  <input key={i} ref={(el) => { inputs.current[i] = el; }} type="text" inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={V.digit(i + 1)} value={d} disabled={busy} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => onBack(i, e)} />
                ))}
              </div>
              {error && <p className="error" role="alert" style={{ marginTop: '.6rem' }}>{error}</p>}
              <button type="button" disabled={busy || digits.some((d) => !d)} onClick={() => verify(digits.join(''))}>{V.verify}</button>
              <button type="button" className="linkbtn" disabled={busy || wait > 0} onClick={() => { setStep('phone'); setError(''); }}>{wait > 0 ? V.resendIn(wait) : V.resend}</button>
              <p className="vfine">{V.expires}</p>
            </div>
          )}
          {step === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div className="tick" style={{ margin: '0 auto .8rem' }}><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M14 27l8 8 16-17" /></svg></div>
              <h2 id="vtitle">{V.doneTitle}</h2>
              <p>{V.doneBody}</p>
              <button type="button" onClick={() => onDone(true)}>{V.cont}</button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
