// Small line icons for the phone's bottom bar. Decorative: the text label next to each one is what screen readers read.
const PATHS = {
  '/issues': <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  '/tracker': <path d="M4 20V11M10 20V4M16 20v-6M2 20h20" />,
  '/directory': <path d="M4 21V5l8-3v19M12 21V9l8 3v9M2 21h20M8 8h.01M8 12h.01M8 16h.01" />,
  '/my': <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
};

export default function NavIcon({ href }) {
  const p = PATHS[href];
  if (!p) return null;
  return (
    <svg className="navicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
  );
}
