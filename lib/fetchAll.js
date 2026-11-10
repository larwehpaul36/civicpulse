// Supabase returns at most 1000 rows per request by default, however large a limit() is asked for. This reads every page.
// makeQuery(from, to) must return a query ordered by something stable, with .range(from, to) applied.
export async function fetchAll(makeQuery, { pageSize = 1000, maxRows = 100000 } = {}) {
  const out = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
