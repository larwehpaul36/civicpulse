import { handleSendSms } from '@/lib/smsHook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called by Supabase (never by the browser) whenever someone asks for a login code.
export async function POST(req) {
  const body = await req.text();
  const { status, json } = await handleSendSms({ body, headers: Object.fromEntries(req.headers), env: process.env });
  return Response.json(json, { status });
}
