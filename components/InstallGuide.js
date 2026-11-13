'use client';
// Step-by-step "add to Home Screen" for iPhones that have not done it yet. Shown only where it is needed.
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { needsInstallGuide, readEnvironment } from '@/lib/installGuide';
import '@/components/intro.css';

export default function InstallGuide({ open = false }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(needsInstallGuide(readEnvironment())); }, []);
  if (!show) return null;
  const g = s.installGuide;
  return (
    <details className="installguide" open={open}>
      <summary>{g.title}</summary>
      <p>{g.why}</p>
      <ol>{g.steps.map((t) => <li key={t}>{t}</li>)}</ol>
      <p className="hint">{g.note}</p>
    </details>
  );
}
