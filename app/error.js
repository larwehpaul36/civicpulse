'use client';
import { useEffect } from 'react';
import { strings as s } from '@/lib/strings';
import { getReporter } from '@/components/ErrorReporter';

// Shown when one page breaks while the rest of the app (menu, footer) still works.
export default function ErrorPage({ error, reset }) {
  useEffect(() => { getReporter()('render', error); }, [error]);
  return (
    <main className="wrap">
      <h1 className="page-title">{s.errorPage.title}</h1>
      <p>{s.errorPage.body}</p>
      <p className="cta-row">
        <button type="button" onClick={() => reset()}>{s.errorPage.retry}</button>
        <a className="cta ghost" href="/">{s.errorPage.home}</a>
      </p>
    </main>
  );
}
