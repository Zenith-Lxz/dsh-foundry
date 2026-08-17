/**
 * Lint configuration.
 *
 * Type-aware rules only where they earn their cost. The set is deliberately
 * small: a large rule set that has to be suppressed in dozens of places teaches
 * people to reach for `eslint-disable`, and a disabled rule catches nothing.
 * Every rule here has caught a real defect in this repository or guards an
 * invariant the project states elsewhere.
 * @module eslint.config
 */
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/lib/**',
      '**/node_modules/**',
      'release/**',
      'stage/**',
      // Generated fixtures and their reference solutions: the corpus is built
      // by `corpus:build`, so linting it would report on generated content.
      'corpus/**',
      'evidence/**',
      '**/*.d.ts',
      // Vitest's own config is loaded by vitest, not by a project face with
      // strict null checks, which the type-aware rules require.
      'vitest.config.ts',
      // Plain JavaScript by necessity, so it has no TypeScript face to lint from.
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The project's own rule: every remaining `any` must explain itself, so
      // an unexplained one is an error rather than a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      // Floating promises are the defect class behind "the app started but
      // nothing happened": an unawaited failure disappears.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `??` and `?.` distinguish absent from falsy, which several metrics in
      // this repository depend on: a measured `0` must not read as unmeasured.
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Build glue lives beside each package but outside its compiler face, which
    // covers `src` only so published declarations carry no build code. The
    // tools face already includes these files; this points the linter at it.
    files: ['packages/*/build.ts', 'apps/*/build.ts', 'packages/*/tsdown.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.tools.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/tests/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // A test double implementing an async interface has no `await` by
      // design; requiring one would push fixtures toward fake awaits.
      '@typescript-eslint/require-await': 'off',
      // Tests construct partial fixtures on purpose; asserting the full shape
      // would make every fixture a maintenance burden without finding defects.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
)
