'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { strings as s } from '@/lib/strings';
import { MENU_ITEMS } from '@/lib/menuItems';

// "☰" button for phones: opens a small panel with About, Accessibility, Privacy and Open data.
// Closes on a tap outside, Escape, choosing an item, or moving to another page. Hidden on computers (CSS).
export default function MenuButton() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const path = usePathname();
  const t = s.footer;

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btn} type="button" className="menubtn" aria-expanded={open} aria-controls="topmenu"
        aria-label={t.menu} onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav id="topmenu" className="menu-panel" aria-label={t.menuLabel}>
            {MENU_ITEMS.map(([href, key, icon]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon.circle && <circle cx={icon.circle[0]} cy={icon.circle[1]} r={icon.circle[2]} />}<path d={icon.d} /></svg>
                {t[key]}
              </Link>
            ))}
          </nav>
        </>
      )}
    </>
  );
}
