'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MyReportsLink from '@/components/MyReportsLink';
import { strings as s } from '@/lib/strings';

const LINKS = [
  ['/', 'navReport'], ['/issues', 'navIssues'], ['/tracker', 'navTracker'], ['/directory', 'navDirectory'],
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/" className="brand" aria-label={s.appName}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#f2b705" />
            <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#0f1f17" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {s.appName}
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([href, key]) => (
            <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{s[key]}</Link>
          ))}
          <MyReportsLink />
        </nav>
      </div>
    </header>
  );
}
