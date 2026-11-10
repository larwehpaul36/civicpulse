// Supabase Edge Function `auth-email`: the optional "Send Email" hook. Setup is in README.md next to this file.
// Deploy with: supabase functions deploy auth-email --no-verify-jwt   (the function checks the hook's own signature)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleSendEmail } from './core.js';

const env = (name: string) => Deno.env.get(name) ?? '';
const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const db = {
  async allow(userId: string, to: string, type: string) {
    const { data, error } = await supabase.rpc('allow_auth_email', { p_user: userId, p_to: to, p_type: type });
    if (error) throw error;
    return data as { allowed: boolean; reason: string };
  },
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('forbidden', { status: 403 });
  const body = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const result = await handleSendEmail({
    body, headers, db,
    env: {
      SEND_EMAIL_HOOK_SECRET: env('SEND_EMAIL_HOOK_SECRET'), RESEND_API_KEY: env('RESEND_API_KEY'),
      EMAIL_FROM: env('EMAIL_FROM'), SUPABASE_URL: env('SUPABASE_URL'),
    },
  });
  return Response.json(result.json, { status: result.status });
});
