// Which required fields of the report form are still empty, step by step. The form shows a "*" on every field
// listed here and a message under each missing one, so people learn what is needed before they press Next.
//   step 0 (the problem): category, the reporter's own words when "Other" is chosen, and the photo
//   step 1 (the place): the region and the exact spot on the map
// Everything else (severity, district, details) is optional.
export const REQUIRED = { 0: ['category', 'other', 'photo'], 1: ['region', 'spot'] };

export function missingFor(step, { categoryId, photo, loc, regionId, isOther, otherLabel }) {
  const m = [];
  if (step === 0) {
    if (!categoryId) m.push('category');
    if (isOther && !String(otherLabel ?? '').trim()) m.push('other');
    if (!photo) m.push('photo');
  } else if (step === 1) {
    if (!regionId) m.push('region');
    if (!loc) m.push('spot');
  }
  return m;
}

// "This may already be reported" check. Phone GPS is often 20-50 m off, so 50 m missed real matches; 100 m catches them,
// and the person can always answer "This is a different problem".
export const DUPLICATE_RADIUS_M = 100;
// A match with no description (it is optional) would show as a dash. Say what to do instead.
export const duplicateText = (d, fallback) => String(d?.description ?? '').trim() || fallback;
