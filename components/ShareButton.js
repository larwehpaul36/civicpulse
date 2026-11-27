'use client';
import { useEffect, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { isCardPath, sharePicture } from '@/lib/sharePicture';

// WhatsApp first (that is where people share in Ghana), then the phone's own share sheet, then copy-link.
// With a cardPath (a report page) there is also a picture to post as a Status or on Facebook, and to save.
export default function ShareButton({ title, text, cardPath }) {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUrl(window.location.href); }, []);
  const picture = isCardPath(cardPath) ? cardPath : null;

  async function share() {
    setMsg('');
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); setMsg(s.share.copied); } catch { setMsg(url); }
  }

  async function shareAsPicture() {
    setMsg(''); setBusy(true);
    const r = await sharePicture({ fetchImpl: fetch, nav: navigator, FileCtor: File, path: picture, title, text: `${text} ${url}` });
    setBusy(false);
    if (r === 'failed') setMsg(s.share.pictureFailed);
    // This phone or browser cannot share files: the picture opens so it can be saved from there.
    if (r === 'unsupported') window.open(picture, '_blank', 'noopener');
  }

  return (
    <div className="sharerow">
      <a className="cta" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">{s.share.whatsapp}</a>
      <button type="button" className="secondary" onClick={share}>{s.share.button}</button>
      {picture && <button type="button" className="secondary" disabled={busy} onClick={shareAsPicture}>{busy ? s.share.pictureBusy : s.share.picture}</button>}
      {picture && <a className="cta ghost" href={picture} download="civicpulse-report.png">{s.share.savePicture}</a>}
      {msg && <span className="hint" aria-live="polite">{msg}</span>}
    </div>
  );
}
