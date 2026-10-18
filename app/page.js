import HomeHero from '@/components/HomeHero';
import ReportForm from '@/components/ReportForm';
import { home as h } from '@/lib/homeStrings';

export default function Home() {
  return (
    <main>
      <HomeHero />
      <section className="how">
        <h2>{h.howTitle}</h2>
        <ol className="steps">
          {h.steps.map((st, i) => (
            <li key={st.t} className="scroll-reveal reveal" style={{ '--i': i }}><h3>{st.t}</h3><p>{st.d}</p></li>
          ))}
        </ol>
      </section>
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
