'use client';
// Holds the chosen language. The first render is always English, exactly like the server's, so nothing mismatches;
// then the saved language is applied and the page below is rebuilt once. Switching language rebuilds it too,
// so finish or save a half-filled form before switching.
import { createContext, useCallback, useContext, useEffect, useState, Fragment } from 'react';
import { applyLanguage } from '@/lib/lang';
import { visibleLanguages, isVisible, htmlLang } from '@/lib/languages';

const SHOW = process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_LANGS === '1';
const OPTIONS = visibleLanguages(SHOW);
const Ctx = createContext({ lang: 'en', setLang: () => {}, options: OPTIONS });
export const useLang = () => useContext(Ctx);

export default function LangProvider({ children }) {
  const [lang, setLangState] = useState('en');
  const [version, setVersion] = useState(0);

  const setLang = useCallback(async (wanted) => {
    let code = isVisible(wanted, SHOW) ? wanted : 'en';
    try { code = await applyLanguage(code); } catch { code = await applyLanguage('en'); } // offline and not cached: stay in English
    document.documentElement.lang = htmlLang(code);
    setLangState(code); setVersion((v) => v + 1);
    try { localStorage.setItem('lang', code); } catch { /* private window: works for this visit only */ }
  }, []);

  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem('lang'); } catch { /* ignore */ }
    if (saved && saved !== 'en') setLang(saved);
  }, [setLang]);

  return <Ctx.Provider value={{ lang, setLang, options: OPTIONS }}><Fragment key={version}>{children}</Fragment></Ctx.Provider>;
}
