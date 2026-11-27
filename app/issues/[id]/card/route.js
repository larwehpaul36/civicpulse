import { ImageResponse } from 'next/og';
import { getShare } from '@/lib/shareData';
import { squareCard, brandCard, SQUARE } from '@/lib/ogCard';
import { ogFonts } from '@/lib/ogFonts';

// The picture people share from a report page: /issues/<id>/card. Public facts only (same as the link preview).
export const revalidate = 300;

export async function GET(_request, { params }) {
  const { id } = await params;
  const d = await getShare(id);
  return new ImageResponse(d ? squareCard(d) : brandCard(), {
    ...SQUARE, fonts: await ogFonts(),
    headers: { 'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600' },
  });
}
