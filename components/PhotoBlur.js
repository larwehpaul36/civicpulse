'use client';
// Optional step after choosing a photo: draw boxes over faces, number plates or house numbers.
// Everything happens on the phone; the original photo is never uploaded when boxes are applied.
import { useEffect, useRef, useState } from 'react';
import { strings as s } from '@/lib/strings';
import { normRect, isUsableRect, grow, pixelateAll } from '@/lib/blur';

const MAX_SIDE = 1280;

export default function PhotoBlur({ file, onApply }) {
  const [open, setOpen] = useState(false);
  const [rects, setRects] = useState([]);
  const [drag, setDrag] = useState(null); // { a, b } in canvas pixels
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);
  const baseRef = useRef(null); // untouched ImageData of the working copy
  const t = s.blur;
  const canDetect = typeof window !== 'undefined' && 'FaceDetector' in window;

  // Reset when a different photo is chosen.
  useEffect(() => { setOpen(false); setRects([]); setDrag(null); setMsg(''); baseRef.current = null; }, [file]);

  // Load the photo into the working canvas when the editor opens.
  useEffect(() => {
    if (!open || !file) return;
    let dead = false;
    (async () => {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
        if (dead) return;
        const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        const c = canvasRef.current;
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        baseRef.current = ctx.getImageData(0, 0, c.width, c.height);
        paint([], null);
      } catch { setMsg(t.failed); }
    })();
    return () => { dead = true; };
  }, [open, file]);

  function paint(list, live) {
    const c = canvasRef.current, base = baseRef.current;
    if (!c || !base) return;
    const ctx = c.getContext('2d');
    const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    pixelateAll(img.data, img.width, img.height, list);
    ctx.putImageData(img, 0, 0);
    if (live) {
      const r = normRect(live.a, live.b, c.width, c.height);
      ctx.lineWidth = Math.max(2, c.width / 300); ctx.strokeStyle = '#f2b705'; ctx.setLineDash([10, 6]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
  useEffect(() => { paint(rects, drag); }, [rects, drag]);

  const point = (e) => {
    const c = canvasRef.current, box = c.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * c.width, y: ((e.clientY - box.top) / box.height) * c.height };
  };
  const down = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); const p = point(e); setDrag({ a: p, b: p }); setMsg(''); };
  const move = (e) => { if (drag) setDrag({ ...drag, b: point(e) }); };
  const up = () => {
    if (!drag) return;
    const c = canvasRef.current, r = normRect(drag.a, drag.b, c.width, c.height);
    setDrag(null);
    if (isUsableRect(r)) setRects((l) => [...l, r]); else setMsg(t.tooSmall);
  };

  async function findFaces() {
    setMsg(''); setBusy(true);
    try {
      const c = canvasRef.current;
      const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 20 }).detect(c);
      const found = faces.map((f) => grow({ x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height }, 0.25, c.width, c.height)).filter((r) => isUsableRect(r, 1));
      setRects((l) => [...l, ...found]);
      setMsg(found.length ? t.found(found.length) : t.noneFound);
    } catch { setMsg(t.detectFailed); }
    setBusy(false);
  }

  function apply() {
    const c = canvasRef.current;
    paint(rects, null);
    c.toBlob((blob) => {
      if (!blob) return setMsg(t.failed);
      onApply(blob);
      setOpen(false);
    }, 'image/jpeg', 0.9);
  }

  if (!file) return null;
  if (!open) {
    return <button type="button" className="secondary" onClick={() => setOpen(true)}>{t.open}</button>;
  }
  return (
    <section className="blur" aria-label={t.title}>
      <h3>{t.title}</h3>
      <p className="hint">{t.help}</p>
      <canvas
        ref={canvasRef} className="blurcanvas" role="img" aria-label={t.canvasLabel}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
      />
      <p className="hint" role="status" aria-live="polite">{msg || t.count(rects.length)}</p>
      <div className="row">
        {canDetect && <button type="button" className="secondary" onClick={findFaces} disabled={busy}>{t.findFaces}</button>}
        <button type="button" className="secondary" onClick={() => setRects((l) => l.slice(0, -1))} disabled={!rects.length}>{t.undo}</button>
        <button type="button" onClick={apply}>{rects.length ? t.apply : t.keep}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>{t.cancel}</button>
      </div>
    </section>
  );
}
