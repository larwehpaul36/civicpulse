// Under about 344px wide (the smallest phones) the language pill shows a short code so the top bar still fits.
export const NARROW_QUERY = '(max-width: 21.5rem)';
export const SHORT = { en: 'EN', tw: 'TW', ha: 'HA', ee: 'EE', gaa: 'GA' };
export const optionLabel = (o, narrow) => (narrow ? SHORT[o.code] || o.code.toUpperCase() : o.native);
