// Reader-chosen text size. Stored on this phone only; applied as data-textsize on <html> (CSS scales the root font size).
export const SIZES = ['normal', 'large', 'larger'];
export const KEY = 'civicpulse-textsize';

export const EVENT = 'civicpulse:textsize'; // tells every text-size control on the page that the size changed
export const cleanSize = (v) => (SIZES.includes(v) ? v : 'normal');

export function readSize(storage) {
  try { return cleanSize(storage?.getItem(KEY)); } catch { return 'normal'; }
}

export function saveSize(storage, v) {
  try { storage?.setItem(KEY, cleanSize(v)); return true; } catch { return false; }
}

// Runs in <head> before the page paints, so there is no flash of small text. Kept tiny and dependency free.
export const INIT_SCRIPT = `try{var v=localStorage.getItem('${KEY}');if(v==='large'||v==='larger')document.documentElement.setAttribute('data-textsize',v)}catch(e){}`;

// Next size in the cycle Normal -> Large -> Largest -> Normal (used by the single "Aa" button in the top bar).
export const nextSize = (v) => SIZES[(SIZES.indexOf(cleanSize(v)) + 1) % SIZES.length];

// Put a size on the page. `root` is document.documentElement. Returns the size actually applied.
export function applySize(root, v) {
  const size = cleanSize(v);
  if (size === 'normal') root.removeAttribute('data-textsize'); else root.setAttribute('data-textsize', size);
  return size;
}
