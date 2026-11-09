const expoConfig = require('eslint-config-expo/flat.js');
const prettier = require('eslint-plugin-prettier/recommended');
const compiler = require('eslint-plugin-react-compiler');
// @cli:unistyles-start
const unistyles = require('eslint-plugin-react-native-unistyles');
// @cli:unistyles-end
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');

const restrictedImportPaths = [
  // @cli:unistyles-start
  {
    name: 'react-native',
    importNames: ['StyleSheet'],
    message:
      "Please use unistyles StyleSheet instead. import { StyleSheet } from 'react-native-unistyles'",
  },
  // @cli:unistyles-end
];

// Feature boundaries: other code imports a feature through its public API
// (`@/features/<name>`, i.e. its index.ts), never a file inside it. Inside a
// feature, use relative imports.
const featureBoundaryPattern = {
  group: ['@/features/*/**'],
  message:
    'Import from the feature public API (@/features/<name>) instead. Inside a feature, use relative imports.',
};

module.exports = [
  // 1. Basic Ignores
  {
    ignores: [
      '**/dist/*',
      '**/node_modules/*',
      '**/__tests__/*',
      '**/coverage/*',
      '**/.expo/*',
      '**/.expo-shared/*',
      '**/android/*',
      '**/ios/*',
      '**/.vscode/*',
      '**/docs/*',
      '**/cli/*',
      '**/website/*',
      '**/expo-env.d.ts',
      '**/babel.config.js',
      '**/metro.config.js',
    ],
  },

  // 2. Base Expo Config
  ...expoConfig,

  // 3. Prettier Integration
  prettier,

  // 4. React Compiler
  {
    plugins: {
      'react-compiler': compiler,
    },
    rules: {
      'react-compiler/react-compiler': 'error',
    },
  },

  // 5. FIXED: Custom Rules + Import Overrides (No unrs-resolver)
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
      // @cli:unistyles-start
      'react-native-unistyles': unistyles,
      // @cli:unistyles-end
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
          paths: ['src'],
        },
      },
      'import/ignore': ['node_modules', '\\.(scss|css)$'],
    },
    rules: {
      // DISABLE ALL import/* rules to prevent unrs-resolver errors
      'import/no-unresolved': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/export': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/no-duplicates': 'off',
      'import/no-named-default': 'off',

      // Import Sorting
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^\\u0000'], ['^react', '^@?\\w'], ['^@env', '^@/', '^'], ['^\\.']],
        },
      ],
      'simple-import-sort/exports': 'error',

      // Unused Imports - forcefully remove them
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // @cli:unistyles-start
      // Unistyles
      'react-native-unistyles/no-unused-styles': 'error',
      // @cli:unistyles-end

      // React Native / Expo best practices
      'react/display-name': 'off',
      'react/no-inline-styles': 'off',
      'react/jsx-sort-props': [
        'warn',
        {
          callbacksLast: true,
          shorthandFirst: true,
          ignoreCase: true,
          reservedFirst: true,
        },
      ],
      'no-restricted-imports': [
        'error',
        { paths: restrictedImportPaths, patterns: [featureBoundaryPattern] },
      ],
      'no-restricted-syntax': [
        'error',
        // @cli:unistyles-start
        {
          selector:
            "CallExpression[callee.object.name='StyleSheet'][callee.property.name='create'] > ObjectExpression",
          message:
            'StyleSheet.create should use a callback function: StyleSheet.create(() => ({ ... }))',
        },
        // @cli:unistyles-end
        // @cli:zustand-start — the create CLI removes this block for Redux projects
        {
          // Atomic Zustand selectors. Every `use<Name>Store()` call MUST pass a
          // selector function so the subscription is scoped to a single field.
          // Without a selector, the component re-renders on ANY store change.
          //
          //   bad:   const { user, logout } = useUserStore();
          //   good:  const user   = useUserStore((s) => s.user);
          //          const logout = useUserStore((s) => s.logout);
          //
          // Non-subscribing API access stays unaffected because those calls go
          // through a MemberExpression callee (useUserStore.getState(),
          // useUserStore.persist.rehydrate(), useUserStore.subscribe(...)).
          selector:
            "CallExpression[callee.type='Identifier'][callee.name=/^use[A-Z].*Store$/][arguments.length=0]",
          message:
            'Zustand: pass an atomic selector — useFooStore((s) => s.field). Calling the hook with no arguments subscribes to the entire store and re-renders on every state change.',
        },
        // @cli:zustand-end
      ],
    },
  },

  // 6. App-level wiring may reach into feature internals (e.g. src/store
  //    rehydrating every feature's persisted store).
  {
    files: ['src/store/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: restrictedImportPaths }],
    },
  },

  // 7. TypeScript specific overrides
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 8. Jest setup / mocks and Node-only config files. TypeScript files never
  //    hit `no-undef`, but plain-JS projects generated by the CLI do.
  {
    files: ['jest.setup.*', 'jest.pre-setup.js', '__mocks__/**'],
    languageOptions: {
      globals: { jest: 'readonly', expect: 'readonly', require: 'readonly', module: 'writable' },
    },
  },
  {
    files: ['app.config.*', 'env.*', 'load-env.*'],
    languageOptions: {
      globals: { __dirname: 'readonly', process: 'readonly', require: 'readonly' },
    },
  },

  // 9. Config files specific overrides (allow require)
  {
    files: ['*.config.js', 'app.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
];
