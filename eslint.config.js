// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // Existing navigation/data hooks predate compiler linting. Keep those diagnostics
  // visible as warnings while enforcing the compiler rules on new UI components.
  {
    files: ['src/lib/guidance.ts', 'src/lib/hooks.ts', 'src/components/sheets/ExploreSheets.tsx', 'src/components/sheets/TripSheets.tsx'],
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
