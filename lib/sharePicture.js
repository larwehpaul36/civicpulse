// Share a report as a picture file (WhatsApp Status, Facebook, Instagram, groups). Everything is passed in, so it runs in tests.
// Returns 'shared' | 'cancelled' | 'unsupported' | 'failed'. A failure never throws: the caller shows a friendly line.
export const pictureName = () => 'civicpulse-report.png';

export async function sharePicture({ fetchImpl, nav, FileCtor, path, title, text }) {
  try {
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'unsupported';
    const res = await fetchImpl(path);
    if (!res.ok) return 'failed';
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0) return 'failed';
    const file = new FileCtor([blob], pictureName(), { type: blob.type });
    if (!nav.canShare({ files: [file] })) return 'unsupported';
    // Many apps ignore a separate url when a file is attached, so the link goes in the text.
    await nav.share({ files: [file], title, text });
    return 'shared';
  } catch (e) {
    return e?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

// Only a path on this site, shaped like /issues/<uuid>/card, is ever fetched.
export const isCardPath = (p) => /^\/issues\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/card$/i.test(p ?? '');
