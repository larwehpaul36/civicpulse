'use client';
// A short "what is this?" note for first-time visitors, with a link to the About page. Dismissed once, remembered on this phone.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import '@/components/intro.css';

const KEY = 'introSeen';

export default function NewHere() {
  const [show, setShow] = useState(false);   // starts hidden so returning visitors never see it flash
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* private window: show it each visit */ }
    setShow(!seen);
  }, []);
  if (!show) return null;
  const t = s.intro;
  const close = () => { setShow(false); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  return (
    <section className="newhere" aria-label={t.title}>
      <div>
        <p className="newhere-title">{t.title}</p>
        <p>{t.body}</p>
        <p><Link href="/about">{t.more} →</Link></p>
      </div>
      <button type="button" className="secondary" onClick={close}>{t.gotIt}</button>
    </section>
  );
}
