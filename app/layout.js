import './globals.css';
import Nav from '@/components/Nav';
import SyncBanner from '@/components/SyncBanner';
import ErrorReporter from '@/components/ErrorReporter';
import PhoneVerifyProvider from '@/components/PhoneVerify';
import LangProvider from '@/components/LangProvider';
import SiteFooter from '@/components/SiteFooter';
import { INIT_SCRIPT } from '@/lib/textSize';
import { strings as s } from '@/lib/strings';

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL ? 'https://civicpulse-live.vercel.app' : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(site),
  title: { default: 'CivicPulse', template: '%s · CivicPulse' },
  description: 'Report local problems and track whether they get fixed.',
  openGraph: { siteName: 'CivicPulse', type: 'website' },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport = { themeColor: '#14231c' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} /></head>
      <body>
        <LangProvider>
          <ErrorReporter />
          <a className="skip" href="#main">{s.a11y.skip}</a>
          <PhoneVerifyProvider>
            <Nav />
            <SyncBanner />
            <div id="main" tabIndex={-1}>{children}</div>
            <SiteFooter />
          </PhoneVerifyProvider>
        </LangProvider>
      </body>
    </html>
  );
}
