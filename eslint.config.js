// https://docs.expo.dev/guides/using-eslint/
// Note: ESLint 9 (installed by `expo lint`) only reads flat config
// (eslint.config.js), not the legacy .eslintrc.js format.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*'],
  },
]);
