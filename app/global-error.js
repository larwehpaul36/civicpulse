'use client';
import { useEffect } from 'react';
import { strings as s } from '@/lib/strings';
import { getReporter } from '@/components/ErrorReporter';

// The last safety net: the whole app failed to draw. Plain styles only, because the normal stylesheet may not have loaded.
export default function GlobalError({ error, reset }) {
  useEffect(() => { getReporter()('render', error); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 560, margin: '0 auto', lineHeight: 1.5 }}>
        <h1>{s.errorPage.title}</h1>
        <p>{s.errorPage.body}</p>
        <p>
          <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: '0 1.2rem', fontSize: '1rem' }}>{s.errorPage.retry}</button>{' '}
          <a href="/" style={{ display: 'inline-block', minHeight: 44, lineHeight: '44px' }}>{s.errorPage.home}</a>
        </p>
      </body>
    </html>
  );
}
