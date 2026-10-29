// Cloudflare Turnstile: a free "are you a real person" check that runs in the background (it only shows
// something when it is unsure). It is OFF until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so deploying this changes nothing.
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
export async function getCaptchaToken({ timeoutMs = 20000 } = {}) {
  if (!SITE_KEY) return undefined;
  const turnstile = await loadTurnstile();
  const box = document.createElement('div'); // visible only if Cloudflare needs the person to tap something
  box.style.cssText = 'position:fixed;left:50%;bottom:6rem;transform:translateX(-50%);z-index:95';
  document.body.appendChild(box);
  return new Promise((resolve, reject) => {
    let id;
    const finish = (fn, value) => {
      clearTimeout(timer);
      try { turnstile.remove(id); } catch { /* already gone */ }
      box.remove();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('captcha_timeout')), timeoutMs);
    id = turnstile.render(box, {
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      callback: (token) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('captcha_failed')),
    });
  });
}
