// Accessibility lint for the React code (labels, alt text, roles, keyboard handlers). Run: npm run lint:a11y
import a11y from 'eslint-plugin-jsx-a11y';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'scripts/**', 'tests/**'] },
  {
    files: ['app/**/*.js', 'components/**/*.js'],
    plugins: { 'jsx-a11y': a11y },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: a11y.flatConfigs.recommended.rules,
  },
];
