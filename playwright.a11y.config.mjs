// Automated accessibility audit (axe-core) of every public page, light and dark. Run: npm run test:a11y
import base from './playwright.config.mjs';

process.env.A11Y = '1';
export default { ...base, testDir: 'tests/a11y' };
