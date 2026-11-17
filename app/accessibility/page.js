'use client';
import { strings as s } from '@/lib/strings';
import TextSize from '@/components/TextSize';
import '@/components/intro.css';
import '@/components/footer.css';

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

// Every line in strings.a11yPage.does is something the code really does today. Keep it that way:
// when a feature is removed, remove its line. Gaps are listed plainly in `gaps`.
export default function AccessibilityPage() {
  const A = s.a11yPage;
  return (
    <main className="wrap about">
      <h1 className="page-title">{A.title}</h1>
      <p className="about-lead">{A.lead}</p>

      <section>
        <h2>{A.textTitle}</h2>
        <p>{A.textBody}</p>
        <TextSize />
      </section>

      <section>
        <h2>{A.doesTitle}</h2>
        <ul>{A.does.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <section>
        <h2>{A.gapsTitle}</h2>
        <p>{A.gapsIntro}</p>
        <ul>{A.gaps.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <section>
        <h2>{A.checksTitle}</h2>
        <p>{A.checks}</p>
      </section>

      <section>
        <h2>{A.tellTitle}</h2>
        <p>{A.tell}</p>
        <p>{contact ? <a href={`mailto:${contact}`}>{contact}</a> : A.tellSoon}</p>
      </section>
    </main>
  );
}
