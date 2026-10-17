import Link from 'next/link';
import ReportForm from '@/components/ReportForm';
import { home as h } from '@/lib/homeStrings';

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div>
          <span className="eyebrow reveal">{h.eyebrow}</span>
          <h1 className="reveal" style={{ '--i': 1 }}>{h.titleA}<br /><em>{h.titleB}</em></h1>
          <p className="reveal" style={{ '--i': 2 }}>{h.sub}</p>
          <div className="cta-row reveal" style={{ '--i': 3 }}>
            <a className="cta" href="#report">{h.cta} ↓</a>
            <Link className="cta ghost" href="/tracker">{h.ctaTracker}</Link>
          </div>
        </div>
        <div className="pulse" aria-hidden="true"><i /><i /><i /><b /></div>
      </section>

      <ol className="steps">
        {h.steps.map((st, i) => (
          <li key={st.t} className="scroll-reveal reveal" style={{ '--i': i + 3 }}><h3>{st.t}</h3><p>{st.d}</p></li>
        ))}
      </ol>

      <section id="report" className="wrap" style={{ scrollMarginTop: '5rem' }}>
        <div className="card scroll-reveal">
          <h2>{h.formTitle}</h2>
          <p className="hint" style={{ margin: 0 }}>{h.formSub}</p>
          <ReportForm />
        </div>
      </section>
    </main>
  );
}
