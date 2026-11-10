// "Is it fixed?" (migration 019). After a report is marked resolved, the person who reported it and those who confirmed it
// can say Fixed / Partly / Not fixed. Enough "not really" answers reopen the report on the database side.
// The Supabase client is passed in, so tests can run without a network.
export const ANSWERS = ['fixed', 'partly', 'not_fixed'];

// What the screen needs: the public totals for this round, and whether THIS visitor may answer (and what they said).
// Any failure (older database, signed-out visitor, offline) quietly means "show nothing", never an error screen.
export async function loadFixCheck(supabase, issueId) {
  const [totals, mine] = await Promise.all([
    supabase.from('public_fix_checks').select('reopen_count, fixed, partly, not_fixed').eq('issue_id', issueId).maybeSingle(),
    supabase.rpc('my_fix_check', { p_issue: issueId }),
  ]);
  const t = totals.error ? null : totals.data;
  return {
    reopened: Number(t?.reopen_count) || 0,
    fixed: Number(t?.fixed) || 0,
    partly: Number(t?.partly) || 0,
    notFixed: Number(t?.not_fixed) || 0,
    eligible: !mine.error && mine.data?.eligible === true,
    answer: !mine.error ? mine.data?.answer ?? null : null,
  };
}

// Returns { answer, reopened } or { error: 'not_involved' | 'not_resolved' | 'failed' }.
export async function sendFixCheck(supabase, issueId, answer) {
  if (!ANSWERS.includes(answer)) return { error: 'failed' };
  const { data, error } = await supabase.rpc('submit_fix_check', { p_issue: issueId, p_answer: answer });
  if (error) {
    const text = `${error.message ?? ''} ${error.details ?? ''}`;
    if (text.includes('not_involved')) return { error: 'not_involved' };
    if (text.includes('not_resolved')) return { error: 'not_resolved' };
    return { error: 'failed' };
  }
  return { answer: data?.answer ?? answer, reopened: data?.reopened === true };
}
