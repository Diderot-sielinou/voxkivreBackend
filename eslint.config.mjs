// @ts-check
import eslint from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import promise from 'eslint-plugin-promise';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config — voxlivre-api.
 *
 * Trois rôles :
 * 1. Qualité TS stricte (type-checked) : pas d'`any`, pas de promesse
 *    flottante, imports de types explicites.
 * 2. Hygiène (sonarjs, unicorn, security, promise).
 * 3. **Garde-fou architectural** : les zones `import-x/no-restricted-paths`
 *    et `no-restricted-imports` rendent impossible un import qui violerait
 *    l'hexagonale (cf. docs/adr/0001-hexagonal-architecture.md). C'est le
 *    build qui casse, pas une revue humaine qui doit le remarquer.
 */
export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**'],
  },

  eslint.configs.recommended,

  // TypeScript strict + stylistic, avec type-checking
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  sonarjs.configs.recommended,
  security.configs.recommended,
  unicorn.configs.recommended,
  promise.configs['flat/recommended'],

  // Prettier en dernier : désactive les règles de style en conflit
  eslintPluginPrettierRecommended,

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: './tsconfig.json',
        }),
      ],
    },
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      // --- TypeScript : strict par intention ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // --- Imports : cycles, ordre, doublons ---
      'import-x/no-cycle': ['error', { maxDepth: 5, ignoreExternal: true }],
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-duplicates': 'error',

      // --- Boundaries hexagonales (ADR-0001) ---
      // Règle de dépendance : interface → application → domain ← infrastructure
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/modules/*/domain/**/*',
              from: './src/modules/*/application/**/*',
              message: 'domain/ ne peut pas importer application/ (cf. ADR-0001).',
            },
            {
              target: './src/modules/*/domain/**/*',
              from: './src/modules/*/infrastructure/**/*',
              message: 'domain/ ne peut pas importer infrastructure/ (cf. ADR-0001).',
            },
            {
              target: './src/modules/*/domain/**/*',
              from: './src/modules/*/interface/**/*',
              message: 'domain/ ne peut pas importer interface/ (cf. ADR-0001).',
            },
            {
              target: './src/modules/*/application/**/*',
              from: './src/modules/*/infrastructure/**/*',
              message: 'application/ ne peut pas importer infrastructure/ (cf. ADR-0001).',
            },
            {
              target: './src/modules/*/application/**/*',
              from: './src/modules/*/interface/**/*',
              message: 'application/ ne peut pas importer interface/ (cf. ADR-0001).',
            },
            {
              target: './src/modules/*/interface/**/*',
              from: './src/modules/*/infrastructure/**/*',
              message:
                'interface/ ne peut pas importer infrastructure/ directement (passer par application/, cf. ADR-0001).',
            },
          ],
        },
      ],
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            ['sibling', 'index'],
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'after' }],
        },
      ],

      // --- Promesses ---
      'promise/always-return': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',

      // --- Unicorn : on garde le fort, on coupe le bruit incompatible Nest ---
      'unicorn/prevent-abbreviations': 'off', // trop bruyant pour le naming métier
      'unicorn/filename-case': 'off', // Nest utilise le dot-case : foo.controller.ts
      'unicorn/no-null': 'off', // null a un sens en TS/SQL
      'unicorn/prefer-module': 'off', // toolchain CommonJS
      'unicorn/prefer-top-level-await': 'off', // pas en CommonJS
      'unicorn/no-array-reduce': 'off', // reduce est ok quand justifié
      'unicorn/import-style': 'off', // conflit avec les patterns Nest

      // --- SonarJS : les vrais smells ---
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 4 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-redundant-jump': 'error',

      // --- Security ---
      'security/detect-object-injection': 'off', // trop de faux positifs en TS
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
    },
  },

  // Les classes de module Nest sont decorator-only, souvent vides (légitime)
  {
    files: ['**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // domain/ : zéro dépendance technique (ADR-0001). Le domain est du TS pur.
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*'],
              message: 'domain/ ne doit pas importer @nestjs (cf. ADR-0001).',
            },
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message: 'domain/ ne doit pas importer Drizzle (cf. ADR-0001).',
            },
            {
              group: ['ioredis', 'redis'],
              message: 'domain/ ne doit pas importer un client Redis (cf. ADR-0001).',
            },
            { group: ['bullmq'], message: 'domain/ ne doit pas importer BullMQ (cf. ADR-0001).' },
            {
              group: ['express', '@nestjs/platform-express'],
              message: 'domain/ ne doit pas importer express (cf. ADR-0001).',
            },
            {
              group: ['better-auth', 'better-auth/*'],
              message: 'domain/ ne doit pas importer better-auth (cf. ADR-0001).',
            },
            {
              group: ['@aws-sdk/*', '@google-cloud/*'],
              message: 'domain/ ne doit pas importer un SDK fournisseur (cf. ADR-0001).',
            },
          ],
        },
      ],
    },
  },

  // Tests : on relâche les règles "unsafe" (mocks) sans lâcher le reste
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'unicorn/consistent-function-scoping': 'off',
      // Faux positif : la règle confond une méthode `.catch(...)` d'objet
      // (ex: ProblemDetailsFilter.catch, contrat ExceptionFilter de Nest)
      // avec Promise.prototype.catch.
      'promise/valid-params': 'off',
    },
  },
);
