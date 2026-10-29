import { createClient } from '@supabase/supabase-js';
import { createEnsureUser } from './ensureUser.js';
import { getCaptchaToken } from './captcha.js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Reporting needs no account: sign in anonymously the first time.
export const ensureUser = createEnsureUser({ supabase, getCaptchaToken });
