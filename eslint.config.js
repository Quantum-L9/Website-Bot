// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ESLint v9 flat config. This repo is ESM (`"type": "module"`); the linted surface is
// src/ (TypeScript, tests colocated as *.test.ts) plus scripts/ (TS + .mjs).
//
// Not type-aware (`recommended`, not `recommendedTypeChecked`): the type-checked
// presets need a resolved tsconfig program per linted file, and tsconfig.json covers
// only src/ and scripts/, so anything outside would error out on the parser rather
// than on a real rule.
//
// `prettier` must stay last: it turns off the stylistic rules Prettier owns, so
// formatting has exactly one authority. See the formatter-ownership block in
// AGENTS.md — this repo is `eslint_owned`, meaning the governed IDE profile
// deliberately writes no JS/TS formatter binding and defers to these configs.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.astro/**',
      // Generated and vendored site trees: they carry their own toolchains and are
      // not this repo's source.
      'astro_template/**',
      'examples/**',
      'website_pack/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs under Node. Without this, `no-undef` from the recommended
    // preset reports `console` and `process` as undefined in the .mjs scripts.
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      // Warn, not error, during the initial rollout: this repo has never been linted,
      // so pre-existing findings become visible debt instead of a wall of failures on
      // the first run. Raise to 'error' once the backlog is cleared.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Stages emit inline <script> tags as template literals, where `<\/script>` is
      // a deliberate escape: an unescaped closing tag would terminate the surrounding
      // script block early. The escape is redundant to the JS parser and necessary to
      // the HTML parser, so this rule cannot be an error here.
      'no-useless-escape': 'warn',
    },
  },
  {
    // Colocated vitest specs legitimately reach for `any` when stubbing.
    files: ['src/**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Plain-Node verification scripts: no TS, and console output is their product.
    files: ['scripts/**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-console': 'off' },
  },
  prettier,
);
