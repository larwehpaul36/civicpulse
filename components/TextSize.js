'use client';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { SIZES, EVENT, readSize, saveSize, applySize } from '@/lib/textSize';

// Three buttons that make all text bigger on this device. aria-pressed tells screen readers which one is on.
// Stays in step with the "Aa" button in the top bar through a page event.
export default function TextSize() {
  const [size, setSize] = useState('normal');
  const t = s.footer;
  useEffect(() => {
    const sync = () => setSize(readSize(window.localStorage));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  function choose(v) {
    setSize(applySize(document.documentElement, v));
    saveSize(window.localStorage, v);
    window.dispatchEvent(new Event(EVENT));
  }
  return (
    <div className="textsize" role="group" aria-label={t.textSize}>
      <span className="textsize-label" aria-hidden="true">{t.textSize}</span>
      {SIZES.map((v) => (
        <button key={v} type="button" className="secondary" aria-pressed={size === v} aria-label={`${t.textSize}: ${t.sizes[v]}`} onClick={() => choose(v)}>
          <span aria-hidden="true" className={`ts-${v}`}>A</span>
        </button>
      ))}
    </div>
  );
}
