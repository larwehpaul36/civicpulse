'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { STATUS_COLORS } from '@/lib/status';

const ACCRA = [5.6037, -0.187];

export default function IssuesMap({ issues, onSelect }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const Lref = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || map.current) return;
      const L = mod.default;
      Lref.current = L;
      map.current = L.map(el.current).setView(ACCRA, 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap contributors',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    layer.current.clearLayers();
    const points = [];
    issues.forEach((i) => {
      if (i.lat == null || i.lng == null) return;
      points.push([i.lat, i.lng]);
      Lref.current
        .circleMarker([i.lat, i.lng], {
          radius: 9, color: '#14231c', weight: 2,
          fillColor: STATUS_COLORS[i.status] ?? '#8a948e', fillOpacity: 1,
        })
        .on('click', () => onSelectRef.current(i.id))
        .addTo(layer.current);
    });
    if (points.length) map.current.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  }, [issues, ready]);

  return <div ref={el} className="map tall" role="application" aria-label="Map of reports" />;
}
