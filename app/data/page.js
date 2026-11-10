import { strings as s } from '@/lib/strings';

const D = s.openData;

export default function DataPage() {
  return (
    <main className="wrap">
      <h1 className="page-title">{D.title}</h1>
      <p>{D.intro}</p>
      <section className="card">
        <p><a href="/data/reports.csv" download><strong>{D.reports}</strong></a></p>
        <p className="hint">{D.reportsHint}</p>
        <p><a href="/data/offices.csv" download><strong>{D.offices}</strong></a></p>
        <p className="hint">{D.officesHint}</p>
      </section>
      <h2>{D.notIncludedTitle}</h2>
      <ul>{D.notIncluded.map((t) => <li key={t}>{t}</li>)}</ul>
      <h2>{D.licenceTitle}</h2>
      <p>{D.licence}</p>
      <ul>{D.notes.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="hint">{D.unavailable}</p>
    </main>
  );
}
