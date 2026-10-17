import { strings as s } from '@/lib/strings';

// Lets people add CivicPulse to their home screen, where it opens like an app.
export default function manifest() {
  return {
    name: s.appName,
    short_name: s.appName,
    description: s.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f7f5',
    theme_color: '#14231c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
