import type { Language, Navigation, ProjectOptions, StateLibrary, Styling } from './options.js';
import type { ProjectFiles } from './utils/files.js';

/**
 * `boilerplate.json` — written into every generated project so `add` knows
 * which stack it is patching. Projects created before it existed are detected
 * from their files instead (see `detectStack`).
 */
export const MANIFEST_FILE = 'boilerplate.json';

export interface Stack {
  navigation: Navigation;
  state: StateLibrary;
  styling: Styling;
  language: Language;
}

export interface Manifest extends Stack {
  /** CLI version that created the project. Modules are tied to its Expo SDK. */
  cliVersion: string;
  /** Modules added with `add`, by name, with the CLI version that added them. */
  modules: Record<string, { cliVersion: string }>;
}

export async function writeManifest(
  files: ProjectFiles,
  options: ProjectOptions,
  cliVersion: string,
): Promise<void> {
  const manifest: Manifest = {
    cliVersion,
    navigation: options.navigation,
    state: options.state,
    styling: options.styling,
    language: options.language,
    modules: {},
  };
  await saveManifest(files, manifest);
}

export async function saveManifest(files: ProjectFiles, manifest: Manifest): Promise<void> {
  await files.write(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The manifest, or one rebuilt from the project's files when it's missing. */
export async function loadManifest(files: ProjectFiles): Promise<{
  manifest: Manifest;
  detected: boolean;
}> {
  if (files.exists(MANIFEST_FILE)) {
    return { manifest: JSON.parse(await files.read(MANIFEST_FILE)), detected: false };
  }
  return {
    manifest: { cliVersion: 'unknown', modules: {}, ...(await detectStack(files)) },
    detected: true,
  };
}

async function detectStack(files: ProjectFiles): Promise<Stack> {
  const pkg = JSON.parse(await files.read('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  return {
    navigation: deps['expo-router'] ? 'expo-router' : 'react-navigation',
    state: deps['@reduxjs/toolkit'] ? 'redux' : 'zustand',
    styling: deps['react-native-unistyles']
      ? 'unistyles'
      : deps.uniwind
        ? 'tailwind'
        : 'stylesheet',
    language: files.exists('tsconfig.json') ? 'ts' : 'js',
  };
}

/** True when `dir` looks like a project this CLI generated. */
export function isBoilerplateProject(files: ProjectFiles): boolean {
  return (
    files.exists(MANIFEST_FILE) ||
    (files.exists('package.json') &&
      (files.exists('src/providers/AppProviders.tsx') ||
        files.exists('src/providers/AppProviders.jsx')))
  );
}
