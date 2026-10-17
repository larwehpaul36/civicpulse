// Category and group names are stored as JSON per language: {"en": "...", "tw": "..."}
export const label = (json, lang = 'en') => json?.[lang] ?? json?.en ?? '';
