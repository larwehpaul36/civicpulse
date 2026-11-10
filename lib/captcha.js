// Cloudflare Turnstile: a free "are you a real person" check that runs in the background (it only shows
// something when it is unsure). It is OFF until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so deploying this changes nothing.
import { strings as s } from './strings.js';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
export const captchaEnabled = Boolean(SITE_KEY);

let scriptPromise = null;
function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('captcha_unavailable'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    el.async = true;
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('captcha_unavailable')));
    el.onerror = () => { scriptPromise = null; reject(new Error('captcha_unavailable')); };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

// A one-time token proving the check passed. Undefined when the check is switched off.
// Usually silent. When Cloudflare needs a tap, a short sentence appears above its box so the person knows why,
// and we wait much longer (interactiveTimeoutMs), because a person needs more than a few seconds to notice and tap.
export async function getCaptchaToken({ timeoutMs = 20000, interactiveTimeoutMs = 90000 } = {}) {
  if (!SITE_KEY) return undefined;
  const turnstile = await loadTurnstile();
  const box = document.createElement('div'); // empty and invisible unless Cloudflare needs the person to tap something
  box.style.cssText = 'position:fixed;left:50%;bottom:6rem;transform:translateX(-50%);z-index:95;max-width:90vw';
  const note = document.createElement('p');
  note.textContent = s.captchaPrompt;
  note.hidden = true;
  note.style.cssText = 'margin:0 0 .4rem;padding:.4rem .7rem;border-radius:.5rem;background:#fff;color:#14231c;font:600 .85rem system-ui,sans-serif;text-align:center';
  const widget = document.createElement('div');
  box.append(note, widget);
  document.body.appendChild(box);
  return new Promise((resolve, reject) => {
    let id;
    let timer;
    const finish = (fn, value) => {
      clearTimeout(timer);
      try { turnstile.remove(id); } catch { /* already gone */ }
      box.remove();
      fn(value);
    };
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish(reject, new Error('captcha_timeout')), ms); };
    arm(timeoutMs);
    try {
      id = turnstile.render(widget, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        callback: (token) => finish(resolve, token),
        'error-callback': () => finish(reject, new Error('captcha_failed')),
        'before-interactive-callback': () => { note.hidden = false; arm(interactiveTimeoutMs); },
        'after-interactive-callback': () => { note.hidden = true; },
      });
    } catch {
      finish(reject, new Error('captcha_failed'));
    }
  });
}
