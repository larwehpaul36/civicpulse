'use client';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { SIZES, readSize, saveSize } from '@/lib/textSize';

// Three buttons that make all text bigger on this device. aria-pressed tells screen readers which one is on.
export default function TextSize() {
  const [size, setSize] = useState('normal');
  const t = s.footer;
  useEffect(() => { setSize(readSize(window.localStorage)); }, []);
  function choose(v) {
    setSize(v);
    if (v === 'normal') document.documentElement.removeAttribute('data-textsize');
    else document.documentElement.setAttribute('data-textsize', v);
    saveSize(window.localStorage, v);
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
