// Versions of packages that are NOT in the base template. Bump these together
// with the template's Expo SDK, then run `npm run test:matrix`.
export const VERSIONS = {
  // Redux
  '@reduxjs/toolkit': '^2.13.0',
  'react-redux': '^9.3.0',
  'redux-persist': '^6.0.0',
  'redux-saga': '^1.5.1',

  // React Navigation (Expo Router no longer bundles it as of SDK 57)
  '@react-navigation/native': '^7.5.1',
  '@react-navigation/native-stack': '^7.21.0',
  '@react-navigation/bottom-tabs': '^7.21.0',

  // Tailwind styling (Uniwind compiles Tailwind v4 at bundle time)
  uniwind: '^1.13.1',
  tailwindcss: '^4.3.3',

  // `add notifications`. Messaging's peer pins the exact app version, so bump both together.
  '@react-native-firebase/app': '^27.1.1',
  '@react-native-firebase/messaging': '^27.1.1',
  'react-native-notify-kit': '^10.10.0',
} as const;

export function pick(...names: (keyof typeof VERSIONS)[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, VERSIONS[name]]));
}
