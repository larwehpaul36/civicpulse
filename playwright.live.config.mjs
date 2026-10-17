// Same as playwright.config.mjs but switches on the tests that talk to a real Supabase project.
// (A separate file keeps `npm run test:e2e:live` working on Windows, macOS and Linux.)
process.env.E2E_LIVE = '1';
const base = await import('./playwright.config.mjs');
export default base.default;
