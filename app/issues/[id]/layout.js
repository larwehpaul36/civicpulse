import { getShare } from '@/lib/shareData';
import { strings as s } from '@/lib/strings';

// Gives each report a proper link preview (title, text and image) for WhatsApp, X, Facebook, etc.
export async function generateMetadata({ params }) {
  const { id } = await params;
  const d = await getShare(id);
  if (!d) return { title: 'Report not found', robots: { index: false } };
  const title = `${d.category} · ${s.statusLabels[d.status] ?? d.status}`;
  const description = s.share.line(d.category, d.status, d.days_open);
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', siteName: 'CivicPulse' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function ReportLayout({ children }) {
  return children;
}
