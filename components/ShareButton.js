'use client';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';

// WhatsApp first (that is where people share in Ghana), then the phone's own share sheet, then copy-link.
export default function ShareButton({ title, text }) {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { setUrl(window.location.href); }, []);

  async function share() {
    setMsg('');
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); setMsg(s.share.copied); } catch { setMsg(url); }
  }

  return (
    <div className="sharerow">
      <a className="cta" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">{s.share.whatsapp}</a>
      <button type="button" className="secondary" onClick={share}>{s.share.button}</button>
      {msg && <span className="hint" aria-live="polite">{msg}</span>}
    </div>
  );
}
