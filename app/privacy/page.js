import { strings as s } from '@/lib/strings';

const P = s.privacy;
const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

// DRAFT in plain language. Have it reviewed against Ghana's Data Protection Act, 2012 (Act 843) before a public launch.
export default function PrivacyPage() {
  return (
    <main className="wrap">
      <h1 className="page-title">{P.title}</h1>
      <p className="hint">{P.draft}</p>
      {P.sections.map(([h, text]) => (
        <section key={h}>
          <h2>{h}</h2>
          <p>{text}</p>
        </section>
      ))}
      <h2>{P.contactTitle}</h2>
      <p>{contact ? <a href={`mailto:${contact}`}>{contact}</a> : P.contactSoon}</p>
    </main>
  );
}
