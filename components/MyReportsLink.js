'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { unreadCount } from '@/lib/notifications';
import { strings as s } from '@/lib/strings';
import NavIcon from '@/components/NavIcon';

// Nav link to "My reports", with the number of updates not seen yet.
export default function MyReportsLink() {
  const [count, setCount] = useState(0);
  const path = usePathname();

  useEffect(() => {
    let alive = true;
    const load = () => unreadCount().then((n) => alive && setCount(n)).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('civicpulse:read', () => setCount(0));
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  return (
    <Link href="/my" aria-current={path === '/my' ? 'page' : undefined}>
      <NavIcon href="/my" />
      <span className="navlabel">{s.navMine}</span>
      {count > 0 && <span className="badge" aria-label={s.mine.unread(count)}>{count}</span>}
    </Link>
  );
}
