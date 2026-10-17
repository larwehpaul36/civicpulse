import { strings as s } from '@/lib/strings';

export const metadata = { title: `${s.outbox.pageTitle} · ${s.appName}`, robots: { index: false } };

// Shown when a page that needs a connection is opened with no signal.
// A plain <a> (not next/link) so the service worker answers the link with the saved report form.
export default function Offline() {
  return (
    <main className="wrap">
      <h1 className="page-title">{s.outbox.pageTitle}</h1>
      <p>{s.outbox.pageBody}</p>
      <p><a href="/">{s.outbox.pageLink}</a></p>
    </main>
  );
}
