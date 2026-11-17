'use client';
import Link from 'next/link';
import { strings as s } from '@/lib/strings';
import TextSize from '@/components/TextSize';
import '@/components/footer.css';

export default function SiteFooter() {
  const t = s.footer;
  return (
    <footer className="sitefooter">
      <nav aria-label={t.label}>
        <Link href="/about">{t.about}</Link>
        <Link href="/accessibility">{t.accessibility}</Link>
        <Link href="/privacy">{t.privacy}</Link>
        <Link href="/data">{t.data}</Link>
      </nav>
      <TextSize />
    </footer>
  );
}
