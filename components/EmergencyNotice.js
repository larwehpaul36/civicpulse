import { EMERGENCY, spaced, telHref } from '@/lib/emergency';
import { strings as s } from '@/lib/strings';

const E = s.emergency;

// Server-safe and dependency-free so it also renders on the offline report form.
export default function EmergencyNotice({ compact = false }) {
  return (
    <aside className="warn emergency" role="note" aria-label={E.title}>
      <p><strong>{E.title}</strong> {E.lead}</p>
      <ul className="emergency-list">
        {EMERGENCY.map((e) => (
          <li key={e.key}><a href={telHref(e.number)}><strong>{spaced(e.number)}</strong> {E.names[e.key]}</a></li>
        ))}
      </ul>
      {!compact && <p className="hint">{E.notService}</p>}
    </aside>
  );
}
