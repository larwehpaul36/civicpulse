'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { strings as s } from '@/lib/strings';

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
      {noTiles && <p className="hint">{s.mapOffline}</p>}
    </div>
  );
}
