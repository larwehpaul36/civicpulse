'use client';
import { useLang } from '@/components/LangProvider';

// Shown only when there is more than one language the resident may use, so nothing changes until a language is approved.
export default function LanguageSwitch() {
  const { lang, setLang, options } = useLang();
  if (options.length < 2) return null;
  return (
    <select className="langswitch" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
      {options.map((o) => <option key={o.code} value={o.code} lang={o.html}>{o.native}</option>)}
    </select>
  );
}
