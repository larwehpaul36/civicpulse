// Category and group names are stored as JSON per language: {"en": "...", "tw": "..."}
// With no language given, the language the resident picked is used; a missing translation falls back to English.
import { currentLang } from './lang.js';
export const label = (json, lang = currentLang()) => json?.[lang] ?? json?.en ?? '';
