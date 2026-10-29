'use client';
import { useEffect, useState } from 'react';
import { syncer } from '@/lib/sync';
import { useOutbox } from '@/lib/useOutbox';
import { strings as s } from '@/lib/strings';
import { useVerify } from '@/components/PhoneVerify';

// Sits under the nav on every page: registers the service worker, keeps the outbox syncing,
// and shows what is waiting, so a resident always knows whether a report has left the phone.
export default function SyncBanner() {
  const { items, running } = useOutbox();
  const [online, setOnline] = useState(true);
  const ask = useVerify();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // In development the worker would serve stale code. Remove any left over from a production run.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Scripts loaded before the worker took over (such as the map) are not cached yet: hand them over.
        setTimeout(() => {
          const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/'));
          reg.active?.postMessage({ type: 'CACHE_URLS', urls });
        }, 3000);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => syncer.syncAll().catch(() => {});
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(sync, 30000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  const pending = items.filter((i) => i.status === 'pending');
  const failed = items.filter((i) => i.status === 'failed');
  const phoneWait = items.filter((i) => i.status === 'needs_phone');
  if (online && !pending.length && !failed.length && !phoneWait.length) return null;

  return (
    <div className="banners" role="status" aria-live="polite">
      {!online && <p className="banner">{s.outbox.offlineNow}</p>}
      {pending.length > 0 && (
        <div className="banner">
          <p>{s.outbox.waiting(pending.length)}</p>
          {online && (
            <button type="button" className="secondary" disabled={running} onClick={() => syncer.syncAll({ ignoreBackoff: true }).catch(() => {})}>
              {running ? s.outbox.sendingNow : s.outbox.sendNow}
            </button>
          )}
        </div>
      )}
      {phoneWait.length > 0 && (
        <div className="banner">
          <p>{s.verify.waiting(phoneWait.length)}</p>
          <button type="button" className="secondary" onClick={async () => { if (await ask()) syncer.resumeAfterVerification().catch(() => {}); }}>{s.verify.verifyToSend}</button>
        </div>
      )}
      {failed.map((item) => (
        <div className="banner banner-error" key={item.id}>
          <p>{s.outbox.failedItem(new Date(item.createdAt).toLocaleString())}</p>
          {item.lastError && <p className="hint">{item.lastError}</p>}
          <div className="row">
            <button type="button" className="secondary" onClick={() => syncer.retry(item.id).catch(() => {})}>{s.outbox.tryAgain}</button>
            <button type="button" className="secondary" onClick={() => { if (window.confirm(s.outbox.discardAsk)) syncer.discard(item.id); }}>
              {s.outbox.discard}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
