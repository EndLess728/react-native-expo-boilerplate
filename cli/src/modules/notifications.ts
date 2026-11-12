import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import * as p from '@clack/prompts';

import { MODULES_DIR } from '../template.js';
import { pick } from '../versions.js';
import { CancelledError, type ModuleContext, type ModuleGenerator } from './types.js';

const DIR = join(MODULES_DIR, 'notifications');
const DEFAULT_ENDPOINT = 'devices/push-token';

const FIREBASE_FILES = [
  { name: 'google-services.json', platform: 'Android', flag: 'googleServices' },
  { name: 'GoogleService-Info.plist', platform: 'iOS', flag: 'googleServiceInfo' },
] as const;

const JEST_MOCKS = `
// Push notifications (added by \`create-expo-boilerplate add notifications\`).
// NotifyKit ships its own mock with real enum values. Firebase is stubbed to
// exactly the modular surface \`src/notifications/service.ts\` calls, so a
// regression to the deprecated namespaced API fails here rather than on device.
jest.mock('react-native-notify-kit', () => require('react-native-notify-kit/jest-mock'));

jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  getApp: jest.fn().mockReturnValue({ name: '[DEFAULT]' }),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  getMessaging: jest.fn().mockReturnValue({}),
  getToken: jest.fn().mockResolvedValue('test-fcm-token'),
  registerDeviceForRemoteMessages: jest.fn().mockResolvedValue(undefined),
  onTokenRefresh: jest.fn().mockReturnValue(jest.fn()),
  onMessage: jest.fn().mockReturnValue(jest.fn()),
  onNotificationOpenedApp: jest.fn().mockReturnValue(jest.fn()),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  setBackgroundMessageHandler: jest.fn(),
}));
`;

const firebaseHelper = (ts: boolean) => `
// Firebase config files live in ./firebase/ (added by \`create-expo-boilerplate
// add notifications\`). A missing file only warns here so Metro and
// \`expo config\` keep working; \`expo prebuild\` fails until both are added.
const firebaseFile = (name${ts ? ': string' : ''}) => {
  const path = resolve(__dirname, 'firebase', name);
  if (existsSync(path)) return path;
  console.warn(\`[app.config] firebase/\${name} not found — native builds fail until you add it.\`);
  return undefined;
};
`;

type Json = Record<string, unknown>;

function deepMerge(target: Json, source: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] =
      value && typeof value === 'object' && existing && typeof existing === 'object'
        ? deepMerge(existing as Json, value as Json)
        : (existing ?? value);
  }
  return out;
}

async function askEndpoint(ctx: ModuleContext, flag: unknown): Promise<string> {
  const validate = (v: string | undefined) =>
    !v?.trim()
      ? 'An endpoint is required.'
      : /[\s'"`\\]/.test(v)
        ? 'No spaces, quotes or backslashes.'
        : undefined;

  if (typeof flag === 'string') {
    const error = validate(flag);
    if (error) throw new Error(`--token-endpoint: ${error}`);
    return flag.trim();
  }
  if (!ctx.interactive) return DEFAULT_ENDPOINT;

  const answer = await p.text({
    message:
      'Backend endpoint that receives the push token (POST, relative to EXPO_PUBLIC_API_URL)',
    initialValue: DEFAULT_ENDPOINT,
    validate,
  });
  if (p.isCancel(answer)) throw new CancelledError();
  return answer.trim();
}

async function askBanner(ctx: ModuleContext, flag: unknown): Promise<boolean> {
  if (typeof flag === 'boolean') return flag;
  if (!ctx.interactive) return true;
  const answer = await p.confirm({
    message: 'Show the notification permission banner on the Settings screen?',
    initialValue: true,
  });
  if (p.isCancel(answer)) throw new CancelledError();
  return answer;
}

/** Copies the Firebase files the user points at into ./firebase/. Returns the ones still missing. */
async function copyFirebaseFiles(
  ctx: ModuleContext,
  flags: Record<string, unknown>,
): Promise<string[]> {
  const missing: string[] = [];

  for (const file of FIREBASE_FILES) {
    const dest = `firebase/${file.name}`;
    if (ctx.files.exists(dest)) continue;

    let source = typeof flags[file.flag] === 'string' ? (flags[file.flag] as string) : '';
    if (!source && ctx.interactive) {
      const answer = await p.text({
        message: `Path to ${file.name} (${file.platform}) — press Enter to skip and add it later`,
        placeholder: `~/Downloads/${file.name}`,
        validate: (v) => {
          if (!v?.trim()) return undefined;
          return existsSync(expand(v, ctx.cwd)) ? undefined : 'No file at that path.';
        },
      });
      if (p.isCancel(answer)) throw new CancelledError();
      source = answer ?? '';
    }

    if (!source.trim()) {
      missing.push(file.name);
      continue;
    }
    const abs = expand(source, ctx.cwd);
    if (!existsSync(abs)) throw new Error(`${file.name}: no file at ${abs}`);
    await ctx.files.write(dest, '');
    await copyFile(abs, ctx.files.abs(dest));
  }

  return missing;
}

function expand(path: string, cwd: string): string {
  const trimmed = path.trim().replace(/^['"]|['"]$/g, '');
  const home = process.env.HOME ?? '';
  return resolve(cwd, trimmed.startsWith('~/') ? join(home, trimmed.slice(2)) : trimmed);
}

export const notifications: ModuleGenerator = {
  name: 'notifications',
  description: 'Push + local notifications (Firebase Cloud Messaging + NotifyKit)',
  flags: [
    {
      flags: '--token-endpoint <path>',
      description: `notifications: token API (default ${DEFAULT_ENDPOINT})`,
    },
    {
      flags: '--google-services <path>',
      description: 'notifications: google-services.json to copy in',
    },
    {
      flags: '--google-service-info <path>',
      description: 'notifications: GoogleService-Info.plist to copy in',
    },
    // Both forms, so the prompt still runs when neither is passed.
    { flags: '--banner', description: 'notifications: add the permission banner to Settings' },
    { flags: '--no-banner', description: 'notifications: skip the permission banner' },
  ],

  async apply(ctx, flags) {
    const { files, pkg, stack, patch } = ctx;
    const ts = stack.language === 'ts';
    const ext = (base: string) =>
      ts ? base : base.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx');

    const endpoint = await askEndpoint(ctx, flags.tokenEndpoint);
    const banner = await askBanner(ctx, flags.banner);
    const missingFirebase = await copyFirebaseFiles(ctx, flags);

    // ── Module files ─────────────────────────────────────────
    await files.overlay(join(DIR, 'files'));
    if (stack.navigation === 'react-navigation') {
      await files.overlay(join(DIR, 'overlays', 'react-navigation'));
      await files.replace(
        'src/notifications/useNotificationPermission.ts',
        "import { useFocusEffect } from 'expo-router';",
        "import { useFocusEffect } from '@react-navigation/native';",
      );
    }
    if (stack.styling !== 'unistyles') {
      await files.overlay(join(DIR, 'overlays', 'styling', stack.styling));
    }
    await files.replace('src/notifications/useNotificationSync.ts', '__TOKEN_ENDPOINT__', endpoint);

    pkg.addDeps(
      pick(
        '@react-native-firebase/app',
        '@react-native-firebase/messaging',
        'react-native-notify-kit',
      ),
    );

    // ── Copy ─────────────────────────────────────────────────
    const translationsDir = join(DIR, 'translations');
    const fallback = JSON.parse(await readFile(join(translationsDir, 'en.json'), 'utf8'));
    for (const rel of await files.list('src/localization/translations')) {
      if (!rel.endsWith('.json')) continue;
      const lang = rel.split('/').pop()!.replace('.json', '');
      const own = join(translationsDir, `${lang}.json`);
      const strings = existsSync(own) ? JSON.parse(await readFile(own, 'utf8')) : fallback;
      const merged = deepMerge(JSON.parse(await files.read(rel)), strings);
      await files.write(rel, `${JSON.stringify(merged, null, 2)}\n`);
    }

    // ── Wiring ───────────────────────────────────────────────
    await patch.insertBefore(
      patch.find('index.ts', 'index.js'),
      /^import (?:'expo-router\/entry'|\{ registerRootComponent \} from 'expo');/m,
      // The blank line keeps it out of the sorted `expo` import group (React Navigation entry).
      "// Push notifications: background handlers + Android channels, before anything renders.\nimport '@/notifications/setup';\n\n",
      "add `import '@/notifications/setup';` to the entry file, above the router/app import.",
    );

    const providers = patch.find(
      'src/providers/AppProviders.tsx',
      'src/providers/AppProviders.jsx',
    );
    const providerMsg =
      'wrap the navigation root in `<NotificationRoot>` (from `@/notifications`), inside `<APIProvider>`.';
    if (
      await patch.edit(
        providers,
        (src) =>
          src.includes('<NotificationRoot>')
            ? src
            : src.includes('<APIProvider>{children}</APIProvider>')
              ? src.replace(
                  '<APIProvider>{children}</APIProvider>',
                  '<APIProvider>\n<NotificationRoot>{children}</NotificationRoot>\n</APIProvider>',
                )
              : null,
        providerMsg,
      )
    ) {
      await patch.insertBefore(
        providers,
        /^import \{ APIProvider \}/m,
        "import { NotificationRoot } from '@/notifications';\n",
        "import `NotificationRoot` from '@/notifications'.",
      );
    }

    if (stack.navigation === 'react-navigation') {
      const app = patch.find('src/App.tsx', 'src/App.jsx');
      const refMsg =
        'pass `ref={navigationRef}` (from `@/navigation/navigationRef`) to `<NavigationContainer>` so notification taps can navigate.';
      if (
        await patch.edit(
          app,
          (src) =>
            src.includes('ref={navigationRef}')
              ? src
              : /<NavigationContainer(\s)/.test(src)
                ? src.replace(
                    /<NavigationContainer(\s)/,
                    '<NavigationContainer ref={navigationRef}$1',
                  )
                : null,
          refMsg,
        )
      ) {
        await patch.insertBefore(
          app,
          /^import \{ AppProviders/m,
          "import { navigationRef } from '@/navigation/navigationRef';\n",
          refMsg,
        );
      }
    }

    if (banner) {
      const settings = patch.find(
        'src/features/settings/screens/SettingsScreen.tsx',
        'src/features/settings/screens/SettingsScreen.jsx',
      );
      const bannerMsg =
        'render `<NotificationPermissionBanner />` (from `@/notifications`) on the screen that should ask for permission.';
      if (
        await patch.insertAfter(
          settings,
          /<ScreenWrapper[^>]*>\n/,
          '<NotificationPermissionBanner />\n',
          bannerMsg,
        )
      ) {
        await patch.insertBefore(
          settings,
          /^import Button from/m,
          "import { NotificationPermissionBanner } from '@/notifications';\n",
          bannerMsg,
        );
      }
    }

    // ── Native config ────────────────────────────────────────
    const appConfig = patch.find('app.config.ts', 'app.config.js');
    const cfgMsg = (what: string) => `${what} — see src/notifications/README.md § Native setup.`;
    await patch.insertAfter(
      appConfig,
      /^import Env from '\.\/env';\n/m,
      `${firebaseHelper(ts)}`,
      cfgMsg('add a `firebaseFile()` helper that resolves files in ./firebase/'),
    );
    const nodeImports =
      "import { existsSync } from 'node:fs';\nimport { resolve } from 'node:path';\n";
    await patch.edit(
      appConfig,
      (src) => {
        if (src.includes("from 'node:fs'")) return src;
        // Sorted the way the project's simple-import-sort wants: with the other
        // packages (`expo/config`, TS only), above the relative `./env` group.
        const expoConfig = /^import \{[^}]*\} from 'expo\/config';\n/m.exec(src);
        if (expoConfig) {
          const end = expoConfig.index + expoConfig[0].length;
          return src.slice(0, end) + nodeImports + src.slice(end);
        }
        const env = /^import Env from '\.\/env';/m.exec(src);
        return env ? `${src.slice(0, env.index)}${nodeImports}\n${src.slice(env.index)}` : null;
      },
      cfgMsg("import `existsSync` from 'node:fs' and `resolve` from 'node:path'"),
    );
    await patch.insertAfter(
      appConfig,
      /^ {2}ios: \{\n/m,
      [
        "    googleServicesFile: firebaseFile('GoogleService-Info.plist'),",
        '    // No config plugin adds these. Without `aps-environment` iOS never issues an',
        '    // APNs token, so FCM has nothing to send to. `development` is right for',
        '    // App Store builds too — Xcode rewrites it to `production` when archiving.',
        "    entitlements: { 'aps-environment': 'development' },",
        "    infoPlist: { UIBackgroundModes: ['remote-notification'] },",
        '',
      ].join('\n'),
      cfgMsg(
        "set `ios.googleServicesFile`, `ios.entitlements['aps-environment']` and `ios.infoPlist.UIBackgroundModes`",
      ),
    );
    await patch.insertAfter(
      appConfig,
      /^ {2}android: \{\n/m,
      "    googleServicesFile: firebaseFile('google-services.json'),\n",
      cfgMsg('set `android.googleServicesFile`'),
    );
    await patch.insertBefore(
      appConfig,
      /^ {4}\[\n {6}'expo-build-properties',/m,
      [
        "    '@react-native-firebase/app',",
        "    '@react-native-firebase/messaging',",
        "    'react-native-notify-kit',",
        '    // Must match DEFAULT_CHANNEL_ID in src/notifications/config.ts.',
        "    './plugins/withAndroidDefaultNotificationChannel',",
        '',
      ].join('\n'),
      cfgMsg(
        'add the `@react-native-firebase/app`, `@react-native-firebase/messaging`, `react-native-notify-kit` and `./plugins/withAndroidDefaultNotificationChannel` plugins',
      ),
    );
    await patch.edit(
      appConfig,
      (src) => {
        if (src.includes('useFrameworks')) return src;
        const anchor = /'expo-build-properties',\n {6}\{\n/;
        return anchor.test(src)
          ? src.replace(
              anchor,
              (m) =>
                `${m}        // React Native Firebase v27 pulls Firebase in via SPM, which needs frameworks.\n        ios: { useFrameworks: 'dynamic' },\n`,
            )
          : null;
      },
      cfgMsg("set `ios.useFrameworks: 'dynamic'` in the `expo-build-properties` plugin options"),
    );

    // ── Tests ────────────────────────────────────────────────
    await patch.edit(
      patch.find('jest.setup.ts', 'jest.setup.js'),
      (src) =>
        src.includes("jest.mock('react-native-notify-kit'")
          ? src
          : `${src.trimEnd()}\n${JEST_MOCKS}`,
      'add the Firebase and NotifyKit mocks from src/notifications/README.md § Testing.',
    );
    await patch.edit(
      'jest.config.js',
      (src) =>
        src.includes('react-native-notify-kit')
          ? src
          : src.includes("'node_modules/(?!(' +\n")
            ? src.replace(
                "'node_modules/(?!(' +\n",
                "'node_modules/(?!(' +\n      'react-native-notify-kit|' +\n",
              )
            : null,
      'add `react-native-notify-kit` to `transformIgnorePatterns`.',
    );

    // ── What's left ──────────────────────────────────────────
    const steps: string[] = [];
    if (missingFirebase.length) {
      steps.push(
        `Required before the next native build: download ${missingFirebase.join(' and ')} from Firebase console → Project settings → Your apps (register the app with your bundle id / package first), and save ${missingFirebase.length > 1 ? 'them' : 'it'} in firebase/.`,
      );
    }
    steps.push(
      'Upload your APNs auth key (.p8) in Firebase console → Project settings → Cloud Messaging, so FCM can deliver to iOS.',
      `Make your backend accept POST ${endpoint} with { token, platform } (or edit ${ext('src/notifications/useNotificationSync.ts')}).`,
      'Rebuild the dev client — these are new native modules: npx expo prebuild --clean, then run ios:development / android:development.',
      'Test remote push on a physical iPhone; the iOS simulator gets no push token.',
    );
    return steps;
  },
};
