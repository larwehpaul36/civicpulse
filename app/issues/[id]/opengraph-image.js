import { ImageResponse } from 'next/og';
import { getShare } from '@/lib/shareData';
import { reportCard, brandCard } from '@/lib/ogCard';
import { ogFonts } from '@/lib/ogFonts';

export const alt = 'CivicPulse report';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 300; // refresh at most every 5 minutes

export default async function Image({ params }) {
  const { id } = await params;
  const d = await getShare(id);
  return new ImageResponse(d ? reportCard(d) : brandCard(), { ...size, fonts: await ogFonts() });
}
