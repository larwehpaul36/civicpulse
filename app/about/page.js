'use client';
import Link from 'next/link';
import { strings as s } from '@/lib/strings';
import InstallGuide from '@/components/InstallGuide';
import '@/components/intro.css';

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function AboutPage() {
  const A = s.about;
  return (
    <main className="wrap about">
      <h1 className="page-title">{A.title}</h1>
      <p className="about-lead">{A.lead}</p>

      <section>
        <h2>{A.whoTitle}</h2>
        <p>{A.who}</p>
      </section>

      <section>
        <h2>{A.howTitle}</h2>
        <ol className="about-steps">
          {A.steps.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}
        </ol>
      </section>

      <section>
        <h2>{A.startTitle}</h2>
        <ul className="about-links">
          {A.links.map(([t, href, d]) => <li key={href}><Link href={href}>{t}</Link><span>{d}</span></li>)}
        </ul>
      </section>

      <section>
        <h2>{A.notTitle}</h2>
        <ul>{A.not.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      <section>
        <h2>{A.privacyTitle}</h2>
        <p>{A.privacy} <Link href="/privacy">{A.privacyLink}</Link></p>
      </section>

      <section>
        <h2>{A.iphoneTitle}</h2>
        <p>{A.iphone}</p>
        <InstallGuide />
      </section>

      <section>
        <h2>{A.contactTitle}</h2>
        <p>{contact ? <a href={`mailto:${contact}`}>{contact}</a> : A.contactSoon}</p>
      </section>
    </main>
  );
}
