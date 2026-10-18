'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MyReportsLink from '@/components/MyReportsLink';
import { strings as s } from '@/lib/strings';
import { home as h } from '@/lib/homeStrings';

const LINKS = [['/', 'navReport', 'navhome'], ['/issues', 'navIssues'], ['/tracker', 'navTracker'], ['/directory', 'navDirectory']];

export default function Nav() {
  const path = usePathname();
  const link = ([href, key, cls]) => (
    <Link key={href} href={href} className={cls} aria-current={path === href ? 'page' : undefined}>{s[key]}</Link>
  );
  return (
    <header className="topbar">
      <div className="flagbar" aria-hidden="true"><i /><i /><i /></div>
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label={s.appName}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#f2b705" />
            <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#0e1f17" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {s.appName}
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.slice(0, 3).map(link)}
          <Link href="/#report" className="fab" aria-label={h.cta}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#0e1f17" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          </Link>
          {LINKS.slice(3).map(link)}
          <MyReportsLink />
        </nav>
      </div>
    </header>
  );
}
