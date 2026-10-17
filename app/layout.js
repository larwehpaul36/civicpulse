import './globals.css';
import Nav from '@/components/Nav';
import SyncBanner from '@/components/SyncBanner';

export const metadata = {
  title: 'CivicPulse',
  description: 'Report local problems and track whether they get fixed.',
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
