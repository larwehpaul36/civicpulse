import { OFFICE_COLUMNS, officeRows, toCsv } from '@/lib/openData';
import { csvResponse, loadPublicData } from '@/lib/openDataServer';

export const dynamic = 'force-dynamic'; // read when asked (and cached for an hour by the CDN), never at build time

export async function GET() {
  try {
    return csvResponse(toCsv(OFFICE_COLUMNS, officeRows(await loadPublicData())), 'civicpulse-offices.csv');
  } catch (err) {
    console.error('open data failed', err?.message);
    return new Response('The data is not available right now. Please try again later.', { status: 503 });
  }
}
