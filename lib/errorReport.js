// Sends a short note to the error log (migration 030) when the app breaks. Pure helpers, so they can be tested.
// Privacy: path only (never the part after ?), no user id, no IP. The database blanks emails, numbers and tokens as well.

// Noise that says nothing about our app: no signal, browser quirks, browser extensions, the captcha script being blocked.
const IGNORE = [
  /ResizeObserver loop/i, /^script error\.?$/i, /failed to fetch/i, /networkerror/i, /load failed/i, /network request failed/i,
  /AbortError/i, /the operation was aborted/i, /(chrome|moz|safari)-extension:/i, /captcha_/i, /challenges\.cloudflare\.com/i,
  /ChunkLoadError/i, /Loading chunk \d+ failed/i, /Non-Error promise rejection/i,
];

export function messageOf(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  return String(err.message ?? err.reason?.message ?? err.reason ?? err);
}

export function shouldIgnore(err, { online = true } = {}) {
  if (!online) return true;
  const text = `${err?.name ?? ''} ${messageOf(err)} ${err?.stack ?? ''}`;
  if (!messageOf(err).trim()) return true;
  return IGNORE.some((re) => re.test(text) || re.test(messageOf(err).trim()));
}

export function buildNote(kind, err, { path = '/', agent = '' } = {}) {
  return {
    p_kind: kind,
    p_path: String(path).split('?')[0].split('#')[0].slice(0, 200),
    p_message: messageOf(err).slice(0, 300),
    p_stack: typeof err?.stack === 'string' ? err.stack.slice(0, 800) : null,
    p_agent: String(agent).slice(0, 120) || null,
  };
}

// One reporter per page visit: the same error is sent once, and at most `max` notes per visit,
// so a bug in a loop cannot flood the database or use up someone's data.
export function createReporter({ send, getContext = () => ({}), max = 5 }) {
  const seen = new Set();
  return function report(kind, err) {
    try {
      const ctx = getContext();
      if (shouldIgnore(err, ctx)) return false;
      const note = buildNote(kind, err, ctx);
      const key = `${kind}|${note.p_message}`;
      if (seen.has(key) || seen.size >= max) return false;
      seen.add(key);
      Promise.resolve(send(note)).catch(() => {});   // reporting must never cause an error itself
      return true;
    } catch { return false; }
  };
}
