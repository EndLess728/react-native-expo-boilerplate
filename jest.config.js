/** @type {import('jest-expo').JestPreset} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.pre-setup.js'],
  setupFilesAfterEnv: ['./jest.setup.ts'],
  // Transform all expo/RN packages that ship ES modules or TypeScript
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      // Every expo-* package: several ship untranspiled ESM (expo-localization,
      // expo-asset, …), and `expo` alone only matches the bare package.
      '@react-native|react-native|expo|expo-[a-z-]+|@expo|@unimodules|' +
      '@react-native-community|react-navigation|@react-navigation|' +
      '@tanstack|react-query-kit|react-native-mmkv|react-native-unistyles|' +
      'react-native-reanimated|react-native-gesture-handler|react-native-screens|' +
      'react-native-safe-area-context|react-native-toast-message' +
      ')/)',
  ],
  // `cli/` is the create-expo-boilerplate package — its overlays have their
  // own tests that only run inside generated projects. `website/` is the docs site.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/cli/', '<rootDir>/website/'],
  modulePathIgnorePatterns: ['<rootDir>/cli/', '<rootDir>/website/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@env$': '<rootDir>/__mocks__/@env.ts',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/assets/**',
    '!src/localization/translations/**',
  ],
};
