// Ghana mobile numbers only (for now). Accepts 024 123 4567, 24 123 4567, +233 24 123 4567, 233241234567.
export function normalizeGhanaPhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('233')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^[25]\d{8}$/.test(d) ? `+233${d}` : null;
}

// +233241234567 -> +233 24 **** 567 (shown back to the person; never stored in the page).
export const maskPhone = (p) => String(p).replace(/^\+233(\d{2})\d{4}(\d{3})$/, '+233 $1 **** $2');
