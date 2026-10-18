import './globals.css';
import Nav from '@/components/Nav';
import SyncBanner from '@/components/SyncBanner';

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL ? 'https://civicpulse-nine-lime.vercel.app' : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(site),
  title: 'CivicPulse',
  description: 'Report local problems and track whether they get fixed.',
  openGraph: { siteName: 'CivicPulse', type: 'website' },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport = { themeColor: '#14231c' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <SyncBanner />
        {children}
      </body>
    </html>
  );
}
