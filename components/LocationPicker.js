'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { strings as s } from '@/lib/strings';
import { planOffline, tileUrl } from '@/lib/mapTiles';

const ACCRA = [5.6037, -0.187];

export default function LocationPicker({ value, onChange }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const Lref = useRef(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('');
  const [noTiles, setNoTiles] = useState(false); // map pictures could not load (no signal)
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const lastSave = useRef(0);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || map.current) return;
      const L = mod.default;
      Lref.current = L;
      map.current = L.map(el.current).setView(ACCRA, 13);
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map.current);
      tiles.on('tileerror', () => setNoTiles(true));
      tiles.on('tileload', () => setNoTiles(false));
      map.current.on('click', (e) => onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      // Keyboard: arrow keys move the map (Leaflet), Enter or Space marks the centre.
      const box = map.current.getContainer();
      box.setAttribute('role', 'application');
      box.setAttribute('aria-label', s.a11y.mapLabel);
      box.addEventListener('keydown', (e) => {
        if (e.target !== box || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        const c = map.current.getCenter();
        onChangeRef.current({ lat: c.lat, lng: c.lng });
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !value) return;
    const pos = [value.lat, value.lng];
    if (marker.current) marker.current.setLatLng(pos);
    else
      marker.current = Lref.current
        .circleMarker(pos, { radius: 10, color: '#14231C', weight: 3, fillColor: '#F2B705', fillOpacity: 1 })
        .addTo(map.current);
    map.current.setView(pos, Math.max(map.current.getZoom(), 16));
  }, [value, ready]);

  // Downloads the map pictures for the area on screen. The service worker keeps them, so the map works with no signal.
  async function saveArea() {
    if (!navigator.onLine) return setSaveMsg(s.offlineMap.needSignal);
    if (!navigator.serviceWorker?.controller) return setSaveMsg(s.offlineMap.noWorker);
    if (Date.now() - lastSave.current < 8000) return setSaveMsg(s.offlineMap.wait);
    const b = map.current.getBounds();
    const plan = planOffline({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.current.getZoom());
    if (plan.tooWide) return setSaveMsg(s.offlineMap.zoomIn);
    lastSave.current = Date.now();
    setSaving(true);
    const queue = [...plan.tiles];
    let done = 0, failed = 0;
    // Two at a time, with short pauses: OpenStreetMap's servers are free and shared.
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        try {
          const res = await fetch(tileUrl(t.z, t.x, t.y), { mode: 'cors', credentials: 'omit' });
          if (!res.ok) failed += 1;
        } catch { failed += 1; }
        done += 1;
        setSaveMsg(s.offlineMap.saving(done, plan.tiles.length));
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    await Promise.all([worker(), worker()]);
    setSaving(false);
    setSaveMsg(failed ? s.offlineMap.partial(plan.tiles.length - failed, failed) : s.offlineMap.saved(plan.tiles.length));
  }

  function locate() {
    setMsg('');
    if (!navigator.geolocation) return setMsg(s.noGps);
    navigator.geolocation.getCurrentPosition(
      (p) => onChange({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg(s.gpsDenied),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div>
      <button type="button" className="secondary" onClick={locate}>{s.useMyLocation}</button>
      <div ref={el} className="map" role="application" aria-label={s.location} />
      <p className="hint">{value ? s.locationSet : s.tapMap} {msg}</p>
      {value && <p className="hint coords">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</p>}
      <p className="hint">{s.a11y.mapKeys}</p>
      <button type="button" className="secondary" onClick={saveArea} disabled={!ready || saving}>{s.offlineMap.save}</button>
      <p className="hint" role="status" aria-live="polite">{saveMsg}</p>
      {noTiles && <p className="hint">{s.mapOffline}</p>}
    </div>
  );
}
