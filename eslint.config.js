import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Lint, for the mistakes the type checker cannot see.
 *
 * Not type-aware, on purpose: `tsc --noEmit` already does that job, and a type-aware lint
 * would run the whole compiler a second time for every file.
 *
 * Only the rules of hooks are an error among the React rules. A hook below an early return
 * crashes the page the first time the condition flips, and that is exactly what this caught
 * in the lesson page. The rest of the react-hooks set comes from the React Compiler, and
 * reports code the compiler would decline to optimise. This app does not run the compiler,
 * so those are worth reading and are warnings, not a failed check.
 */
const compilerRules = Object.fromEntries(
  Object.keys(reactHooks.configs.flat.recommended.rules)
    .filter((rule) => rule !== 'react-hooks/rules-of-hooks')
    .map((rule) => [rule, 'warn']),
)

export default defineConfig([
  // Agent worktrees are full checkouts of this repository, and each one lints itself.
  globalIgnores(['dist', '.vercel', '.claude/worktrees']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `const { xp: _total, ...patch } = row` is how a field is left out of a copy, and tsc
      // already accepts it. Flagging it would mean rewriting it worse.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...compilerRules,
      // A file that exports something other than components reloads the whole page on save
      // instead of swapping in place. Worth knowing, never worth failing a check over.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['api/**/*.ts', 'scripts/**/*.mjs', 'test/**/*.ts', '*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
])
