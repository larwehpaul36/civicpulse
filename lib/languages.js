// The languages CivicPulse knows about, and which of them residents may see.
//   live  : reviewed by a native speaker, shown to everyone
//   draft : written but NOT yet reviewed; shown only where NEXT_PUBLIC_SHOW_UNREVIEWED_LANGS=1 (use it on Vercel Preview)
//   empty : no translation yet, never shown
// When a reviewer approves a language, change its status to 'live' in a pull request: that commit is the review record.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', status: 'live', html: 'en' },
  { code: 'tw', name: 'Twi', native: 'Twi', status: 'draft', html: 'tw' },
  { code: 'ha', name: 'Hausa', native: 'Hausa', status: 'draft', html: 'ha' },
  { code: 'ee', name: 'Ewe', native: 'Eʋegbe', status: 'empty', html: 'ee' },
  { code: 'gaa', name: 'Ga', native: 'Gã', status: 'empty', html: 'gaa' },
];

export const visibleLanguages = (showUnreviewed = false) =>
  LANGUAGES.filter((l) => l.status === 'live' || (showUnreviewed && l.status === 'draft'));

export const isVisible = (code, showUnreviewed = false) => visibleLanguages(showUnreviewed).some((l) => l.code === code);
export const htmlLang = (code) => LANGUAGES.find((l) => l.code === code)?.html ?? 'en';
