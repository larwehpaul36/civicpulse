'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { confirmEmail, unsubscribeEmail } from '@/lib/notifications';
import { isToken } from '@/lib/pushHelpers';
import { strings as s } from '@/lib/strings';

const T = s.tokenPage;

// The page behind the links in our emails. It acts only when the person presses the button,
// so a mail scanner that opens the link cannot confirm or unsubscribe by accident.
export default function TokenAction({ kind }) {
  const token = useSearchParams().get('t');
  const [status, setStatus] = useState('ready'); // ready | working | done | invalid | failed
  const confirming = kind === 'confirm';

  async function go() {
    setStatus('working');
    try {
      const ok = await (confirming ? confirmEmail(token) : unsubscribeEmail(token));
      setStatus(ok ? 'done' : 'invalid');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <main className="wrap">
      <h1 className="page-title">{confirming ? T.confirmTitle : T.unsubTitle}</h1>
      {!isToken(token) || status === 'invalid' ? (
        <p>{T.invalid}</p>
      ) : status === 'done' ? (
        <p aria-live="polite"><strong>{confirming ? T.confirmDone : T.unsubDone}</strong></p>
      ) : (
        <>
          <p>{confirming ? T.confirmBody : T.unsubBody}</p>
          <button type="button" disabled={status === 'working'} onClick={go}>{confirming ? T.confirmButton : T.unsubButton}</button>
          {status === 'failed' && <p aria-live="polite"><strong>{T.failed}</strong></p>}
        </>
      )}
    </main>
  );
}
