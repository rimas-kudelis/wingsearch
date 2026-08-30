// @ts-check
// Replaces tslint, which was deprecated in 2020 and had no Angular 22 builder. The rules
// mirror what tslint.json enforced -- no semicolons, single quotes, 140-column lines,
// app-prefixed selectors -- so the existing code stays lint-clean and the style stays the
// style. Lint is blocking in CI; see .github/workflows/ci.yml.
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const angular = require('angular-eslint')

module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true }],
      // Several bonus-card predicates are one long regex over a card's power text. Wrapping
      // those changes what the pattern matches, so a regex literal is exempt from the column
      // limit while the code around it is not.
      'max-len': ['error', { code: 140, ignorePattern: '^\\s*(//|\\*)', ignoreRegExpLiterals: true }],
      'comma-dangle': ['error', 'only-multiline'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-trailing-spaces': 'error',
      // A handful of bonus-card predicates match every bird and so never read their argument.
      // Naming it `_birdCard` keeps the table one uniform shape per card.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `@ts-ignore` is the established idiom here for the resolveJsonModule mismatch below.
      // `@ts-expect-error` would be stricter, but each of the ~30 sites needs checking to see
      // whether the error it suppresses still exists; that is its own change.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description',
        minimumDescriptionLength: 0 }],
      // Kept as NgModules on purpose: standalone migration is a separate change from the
      // framework upgrade. See the note at the top of tsconfig.json.
      '@angular-eslint/prefer-standalone': 'off',
      // The store deliberately leans on `any`: the JSON card data is typed structurally by
      // resolveJsonModule and does not line up with the hand-written interfaces.
      '@typescript-eslint/no-explicit-any': 'off',
      // Reducer actions carry wide payloads that are narrowed by the type guards in
      // app.interfaces.ts rather than by parameter types.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
    },
  },
)
