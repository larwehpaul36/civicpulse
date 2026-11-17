// Reader-chosen text size. Stored on this phone only; applied as data-textsize on <html> (CSS scales the root font size).
export const SIZES = ['normal', 'large', 'larger'];
export const KEY = 'civicpulse-textsize';

export const cleanSize = (v) => (SIZES.includes(v) ? v : 'normal');

export function readSize(storage) {
  try { return cleanSize(storage?.getItem(KEY)); } catch { return 'normal'; }
}

export function saveSize(storage, v) {
  try { storage?.setItem(KEY, cleanSize(v)); return true; } catch { return false; }
}

// Runs in <head> before the page paints, so there is no flash of small text. Kept tiny and dependency free.
export const INIT_SCRIPT = `try{var v=localStorage.getItem('${KEY}');if(v==='large'||v==='larger')document.documentElement.setAttribute('data-textsize',v)}catch(e){}`;
