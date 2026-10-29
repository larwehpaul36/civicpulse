// Reporting needs no account: the first time one is needed, sign in anonymously (with the bot check, when it is on).
// One sign-in at a time, so two parts of the app asking together never create two accounts.
export function createEnsureUser({ supabase, getCaptchaToken }) {
  let inflight = null;
  return () => {
    inflight ??= (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session.user;
      const captchaToken = await getCaptchaToken();
      const { data, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
      if (error) throw error;
      return data.user;
    })().finally(() => { inflight = null; });
    return inflight;
  };
}
