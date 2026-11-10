'use client';
import { useState } from 'react';
import { useVerify } from '@/components/PhoneVerify';
import { strings as s } from '@/lib/strings';

// Not linked from the menu. A place to try the phone check with your own number (docs/phone-login-setup.md, step 6).
export default function VerifyPage() {
  const ask = useVerify();
  const [result, setResult] = useState(null);
  return (
    <main className="wrap">
      <h1 className="page-title">{s.verifyPage.title}</h1>
      <p>{s.verifyPage.intro}</p>
      <p><button type="button" onClick={async () => setResult(await ask())}>{s.verify.verifyToSend}</button></p>
      {result !== null && <p aria-live="polite"><strong>{result ? s.verify.doneTitle : s.verify.cancelled}</strong></p>}
    </main>
  );
}
