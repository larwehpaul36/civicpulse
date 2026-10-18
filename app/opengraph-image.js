import { ImageResponse } from 'next/og';
import { brandCard } from '@/lib/ogCard';
import { ogFonts } from '@/lib/ogFonts';

export const alt = 'CivicPulse: Your street. Your voice. Their response, in public.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(brandCard(), { ...size, fonts: await ogFonts() });
}
