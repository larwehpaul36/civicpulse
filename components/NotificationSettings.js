'use client';
import { useEffect, useState } from 'react';
import {
  EMAIL_NOTICES, clearContact, disablePush, enablePush, getContact, pushState, relinkPush, saveContact,
} from '@/lib/notifications';
import { strings as s } from '@/lib/strings';

function PushSettings() {
  const [state, setState] = useState('checking'); // checking | unsupported | blocked | on | off
  const [msg, setMsg] = useState('');

  useEffect(() => {
    pushState().then((st) => { setState(st); if (st === 'on') relinkPush().catch(() => {}); }).catch(() => setState('unsupported'));
  }, []);

  async function turnOn() {
    setMsg('');
    try { setState(await enablePush()); } catch (e) { console.error(e); setMsg(s.push.failed); }
  }
  async function turnOff() {
    setMsg('');
    try { await disablePush(); setState('off'); } catch (e) { console.error(e); setMsg(s.push.failed); }
  }

  if (state === 'checking') return null;
  return (
    <section className="panel">
      <h2>{s.push.title}</h2>
      <p>{s.push.explain}</p>
      {state === 'unsupported' && <p className="hint">{s.push.unsupported}</p>}
      {state === 'blocked' && <p className="hint">{s.push.blocked}</p>}
      {state === 'on' && (
        <>
          <p><strong>{s.push.on}</strong></p>
          <button type="button" className="secondary" onClick={turnOff}>{s.push.turnOff}</button>
        </>
      )}
      {state === 'off' && <button type="button" onClick={turnOn}>{s.push.turnOn}</button>}
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </section>
  );
}

function EmailSettings() {
  const [contact, setContact] = useState(undefined); // undefined = loading, null = none
  const [email, setEmail] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { getContact().then(setContact).catch(() => setContact(null)); }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await saveContact(email.trim());
      setContact({ email: email.trim().toLowerCase(), verified: false });
      setMsg(s.email.sentTo(email.trim().toLowerCase()));
      setEmail(''); setAgree(false);
    } catch (err) {
      setMsg(/bad_email/.test(err?.message) ? s.email.bad : /too_soon/.test(err?.message) ? s.email.tooSoon : s.email.failed);
    } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg('');
    try { await clearContact(); setContact(null); setMsg(s.email.removed); }
    catch { setMsg(s.email.failed); }
    finally { setBusy(false); }
  }

  if (contact === undefined) return null;
  return (
    <section className="panel">
      <h2>{s.email.title}</h2>
      <p>{s.email.explain}</p>
      {contact && (
        <>
          <p><strong>{contact.verified ? s.email.confirmed(contact.email) : s.email.pending(contact.email)}</strong></p>
          <button type="button" className="secondary" disabled={busy} onClick={remove}>{s.email.remove}</button>
        </>
      )}
      <form className="panel" onSubmit={save}>
        <label>{s.email.address}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {s.email.consent}
        </label>
        <p className="hint">{s.email.privacy}</p>
        <button type="submit" disabled={busy || !agree || !email.trim()}>{s.email.save}</button>
      </form>
      {msg && <p aria-live="polite"><strong>{msg}</strong></p>}
    </section>
  );
}

export default function NotificationSettings() {
  return (
    <>
      <PushSettings />
      {EMAIL_NOTICES && <EmailSettings />}
    </>
  );
}
