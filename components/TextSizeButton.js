'use client';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { EVENT, readSize, saveSize, applySize, nextSize } from '@/lib/textSize';

// One small "Aa" button in the top bar: each press goes Normal -> Large -> Largest -> Normal.
// Easy to find on any page, instead of only at the bottom. Remembered on this phone only.
export default function TextSizeButton() {
  const [size, setSize] = useState('normal');
  const t = s.footer;
  useEffect(() => {
    const sync = () => setSize(readSize(window.localStorage));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  function press() {
    const next = nextSize(size);
    setSize(applySize(document.documentElement, next));
    saveSize(window.localStorage, next);
    window.dispatchEvent(new Event(EVENT));
  }
  return (
    <button type="button" className="aabtn" onClick={press} aria-label={t.textSizeNow(t.sizes[size])}>
      <b aria-hidden="true">A</b><small aria-hidden="true">a</small>
    </button>
  );
}
