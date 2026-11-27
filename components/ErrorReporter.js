'use client';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { createReporter } from '@/lib/errorReport';

let reporter = null;
// Shared by the page-wide listeners below and the error pages, so a visit never sends more than a handful of notes.
export function getReporter() {
  if (typeof window === 'undefined') return () => false;
  reporter ??= createReporter({
    send: (note) => supabase.rpc('log_client_error', note),
    getContext: () => ({ online: navigator.onLine !== false, path: window.location.pathname, agent: navigator.userAgent }),
  });
  return reporter;
}

// Catches errors that happen outside the page's own rendering: a click handler, a timer, a promise nobody waited for.
export default function ErrorReporter() {
  useEffect(() => {
    const report = getReporter();
    const onError = (e) => report('script', e.error ?? e.message);
    const onRejection = (e) => report('promise', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return null;
}
