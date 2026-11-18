'use client';
import { useEffect, useState } from 'react';
import { useLang } from '@/components/LangProvider';
import { NARROW_QUERY, optionLabel } from '@/lib/languageLabel';

// Shown only when there is more than one language the resident may use, so nothing changes until a language is approved.
export default function LanguageSwitch() {
  const { lang, setLang, options } = useLang();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  if (options.length < 2) return null;
  return (
    <select className="langswitch" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
      {options.map((o) => <option key={o.code} value={o.code} lang={o.html} title={o.native}>{optionLabel(o, narrow)}</option>)}
    </select>
  );
}
