// Shrinks a phone photo (often 4-8 MB) to roughly 150-300 KB before upload.
// Written for older Safari too: each step has a fallback if the modern API is missing or throws.
async function loadSource(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try next */ }
    try { return await createImageBitmap(file); } catch { /* try next */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  const viaDataUrl = () => {
    const bin = atob(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  };
  return new Promise((resolve, reject) => {
    const fallback = () => { try { resolve(viaDataUrl()); } catch (e) { reject(e); } };
    if (!canvas.toBlob) return fallback();
    canvas.toBlob((b) => (b ? resolve(b) : fallback()), 'image/jpeg', quality);
  });
}

export async function compressImage(file, maxSide = 1280, quality = 0.7) {
  const src = await loadSource(file);
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  return canvasToJpeg(canvas, quality);
}
