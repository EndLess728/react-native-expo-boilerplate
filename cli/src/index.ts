#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import * as p from '@clack/prompts';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { addModule, type AddFlags } from './add.js';
import { generateProject } from './generate.js';
import { MODULES } from './modules/index.js';
import {
  CHOICES,
  defaultBundleId,
  DEFAULTS,
  type Language,
  type Navigation,
  type PackageManager,
  type ProjectOptions,
  type ReduxMiddleware,
  type StateLibrary,
  type Styling,
  STYLING_LABEL,
  toDisplayName,
  toPackageName,
  validateBundleId,
  validateProjectName,
} from './options.js';
import { detectPackageManager, PM } from './steps/packageManager.js';
import { PACKAGE_ROOT } from './template.js';
import { commandExists, run } from './utils/exec.js';

const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

interface CliFlags {
  state?: StateLibrary;
  reduxMiddleware?: ReduxMiddleware;
  navigation?: Navigation;
  styling?: Styling;
  language?: Language;
  js?: boolean;
  eslint?: boolean;
  husky?: boolean;
  name?: string;
  bundleId?: string;
  pm?: PackageManager;
  install: boolean;
  git: boolean;
  yes?: boolean;
}

const oneOf =
  <T extends string>(choices: readonly T[]) =>
  (value: string): T => {
    if (!choices.includes(value as T)) {
      throw new InvalidArgumentError(`Expected one of: ${choices.join(', ')}.`);
    }
    return value as T;
  };

const program = new Command()
  // Options after `add` belong to `add`, not to project creation.
  .enablePositionalOptions()
  .name('create-expo-boilerplate')
  .description('Scaffold an Expo app from react-native-expo-boilerplate.')
  .version(version)
  .argument('[directory]', 'where to create the project')
  .option('--state <library>', 'zustand | redux', oneOf(CHOICES.state))
  .option(
    '--redux-middleware <type>',
    'thunk | saga (with --state redux)',
    oneOf(CHOICES.reduxMiddleware),
  )
  .option('--navigation <library>', 'expo-router | react-navigation', oneOf(CHOICES.navigation))
  .option('--styling <library>', 'unistyles | stylesheet | tailwind', oneOf(CHOICES.styling))
  .option('--language <lang>', 'ts | js', oneOf(CHOICES.language))
  .option('--js', 'shorthand for --language js')
  .option('--eslint', 'include ESLint')
  .option('--no-eslint', 'skip ESLint')
  .option('--husky', 'include Husky git hooks')
  .option('--no-husky', 'skip Husky git hooks')
  .option('--name <displayName>', 'app display name')
  .option('--bundle-id <id>', 'iOS bundle identifier / Android package')
  .option('--pm <manager>', 'yarn | npm | pnpm | bun', oneOf(CHOICES.packageManager))
  .option('--no-install', 'skip installing dependencies')
  .option('--no-git', 'skip git init and the initial commit')
  .option('-y, --yes', 'accept defaults for every option not passed as a flag')
  .addHelpText(
    'after',
    `
Examples:
  $ npx create-expo-boilerplate my-app
  $ npx create-expo-boilerplate my-app --state redux --redux-middleware saga --navigation react-navigation
  $ npx create-expo-boilerplate my-app --styling tailwind
  $ npx create-expo-boilerplate my-app --yes --js --no-husky

Add a module to an existing project (run from its root):
  $ npx create-expo-boilerplate add notifications`,
  )
  .action(() => createProject());

const addCommand = program
  .command('add')
  .description('add a module to the project in the current directory')
  .argument('[module]', Object.keys(MODULES).join(' | '))
  .option('-y, --yes', 'accept defaults instead of prompting')
  .option('--dry-run', 'show what would change without writing anything')
  .option('--force', 'run even with uncommitted changes')
  .option('--no-install', 'skip installing dependencies')
  .addHelpText(
    'after',
    `
Modules:
${Object.values(MODULES)
  .map((m) => `  ${m.name.padEnd(16)}${m.description}`)
  .join('\n')}

Examples:
  $ npx create-expo-boilerplate add notifications
  $ npx create-expo-boilerplate add notifications --dry-run
  $ npx create-expo-boilerplate add notifications --yes --token-endpoint users/me/devices`,
  )
  .action((name: string | undefined, flags: AddFlags) => addModule(name, flags, version));
for (const mod of Object.values(MODULES)) {
  for (const flag of mod.flags) addCommand.option(flag.flags, flag.description);
}

function bail(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel('Cancelled — nothing was created.');
    process.exit(0);
  }
}

async function ask<T>(
  given: T | undefined,
  useDefault: boolean,
  fallback: T,
  prompt: () => Promise<T | symbol>,
): Promise<T> {
  if (given !== undefined) return given;
  if (useDefault) return fallback;
  const answer = await prompt();
  bail(answer);
  return answer as T;
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e !== '.DS_Store' && e !== '.git').length === 0;
  } catch {
    return true; // doesn't exist yet
  }
}

async function createProject(): Promise<void> {
  const [dirArg] = program.args as [string | undefined];
  const flags = program.opts<CliFlags>();
  const defaults = Boolean(flags.yes) || !process.stdout.isTTY;

  console.log();
  p.intro(pc.bgCyan(pc.black(' create-expo-boilerplate ')));

  // ── Where ────────────────────────────────────────────────
  const directory = await ask<string>(dirArg, defaults, 'my-app', () =>
    p.text({
      message: 'Project name',
      placeholder: 'my-app',
      defaultValue: 'my-app',
      validate: (v) => (v ? validateProjectName(v) : undefined),
    }),
  );
  const targetDir = resolve(process.cwd(), directory);
  const projectName = basename(targetDir);
  if (validateProjectName(projectName)) {
    p.cancel(validateProjectName(projectName));
    process.exit(1);
  }
  if (!(await isEmptyDir(targetDir))) {
    p.cancel(
      `${pc.bold(relative(process.cwd(), targetDir) || '.')} is not empty. Pick a new directory.`,
    );
    process.exit(1);
  }

  // ── Identity ─────────────────────────────────────────────
  const displayName = await ask<string>(flags.name, defaults, toDisplayName(projectName), () =>
    p.text({
      message: 'App display name',
      initialValue: toDisplayName(projectName),
      validate: (v) => (v?.trim() ? undefined : 'Display name is required.'),
    }),
  );
  if (flags.bundleId && validateBundleId(flags.bundleId)) {
    p.cancel(`--bundle-id: ${validateBundleId(flags.bundleId)}`);
    process.exit(1);
  }
  const bundleId = await ask<string>(flags.bundleId, defaults, defaultBundleId(projectName), () =>
    p.text({
      message: 'Bundle identifier / Android package',
      initialValue: defaultBundleId(projectName),
      validate: (v) => validateBundleId(v ?? ''),
    }),
  );

  // ── Stack ────────────────────────────────────────────────
  const state = await ask<StateLibrary>(flags.state, defaults, DEFAULTS.state, () =>
    p.select<StateLibrary>({
      message: 'State management',
      initialValue: DEFAULTS.state,
      options: [
        { value: 'zustand', label: 'Zustand', hint: 'default — atomic stores, MMKV-persisted' },
        { value: 'redux', label: 'Redux Toolkit', hint: 'slices + redux-persist on MMKV' },
      ],
    }),
  );

  let reduxMiddleware: ReduxMiddleware | null = null;
  if (state === 'redux') {
    reduxMiddleware = await ask<ReduxMiddleware>(
      flags.reduxMiddleware,
      defaults,
      DEFAULTS.reduxMiddleware,
      () =>
        p.select<ReduxMiddleware>({
          message: 'Redux side effects',
          initialValue: DEFAULTS.reduxMiddleware,
          options: [
            { value: 'thunk', label: 'Thunk', hint: 'default — createAsyncThunk, built into RTK' },
            { value: 'saga', label: 'Saga', hint: 'redux-saga generators' },
          ],
        }),
    );
  } else if (flags.reduxMiddleware) {
    p.log.warn('--redux-middleware is ignored without --state redux.');
  }

  const navigation = await ask<Navigation>(flags.navigation, defaults, DEFAULTS.navigation, () =>
    p.select<Navigation>({
      message: 'Navigation',
      initialValue: DEFAULTS.navigation,
      options: [
        { value: 'expo-router', label: 'Expo Router', hint: 'default — file-based routing' },
        { value: 'react-navigation', label: 'React Navigation', hint: 'navigators in code' },
      ],
    }),
  );

  const styling = await ask<Styling>(flags.styling, defaults, DEFAULTS.styling, () =>
    p.select<Styling>({
      message: 'Styling',
      initialValue: DEFAULTS.styling,
      options: [
        { value: 'unistyles', label: 'Unistyles', hint: 'default — themed StyleSheet, light/dark' },
        { value: 'stylesheet', label: 'StyleSheet', hint: 'plain React Native, no extra deps' },
        { value: 'tailwind', label: 'Tailwind', hint: 'className via Uniwind (Tailwind v4)' },
      ],
    }),
  );

  const language = await ask<Language>(
    flags.js ? 'js' : flags.language,
    defaults,
    DEFAULTS.language,
    () =>
      p.select<Language>({
        message: 'Language',
        initialValue: DEFAULTS.language,
        options: [
          { value: 'ts', label: 'TypeScript', hint: 'default' },
          { value: 'js', label: 'JavaScript' },
        ],
      }),
  );

  const eslint = await ask<boolean>(flags.eslint, defaults, DEFAULTS.eslint, () =>
    p.confirm({ message: 'Include ESLint?', initialValue: DEFAULTS.eslint }),
  );
  const husky = await ask<boolean>(flags.husky, defaults, DEFAULTS.husky, () =>
    p.confirm({
      message: 'Include Husky git hooks? (lint-staged + Commitlint)',
      initialValue: DEFAULTS.husky,
    }),
  );

  const detectedPm = detectPackageManager() ?? 'yarn';
  const packageManager = await ask<PackageManager>(flags.pm, defaults, detectedPm, () =>
    p.select<PackageManager>({
      message: 'Package manager',
      initialValue: detectedPm,
      options: CHOICES.packageManager.map((pm) => ({ value: pm, label: pm })),
    }),
  );

  const options: ProjectOptions = {
    projectName,
    targetDir,
    displayName: displayName.trim(),
    bundleId,
    state,
    reduxMiddleware,
    navigation,
    styling,
    language,
    eslint,
    husky,
    packageManager,
    install: flags.install,
    git: flags.git,
  };

  // ── Generate ─────────────────────────────────────────────
  const s = p.spinner();
  s.start('Generating project');
  try {
    await generateProject(options, version, (msg) => s.message(msg));
  } catch (error) {
    s.error('Generation failed');
    throw error;
  }
  s.stop(`Created ${pc.bold(toPackageName(projectName))}`);

  const hasGit = options.git && (await commandExists('git'));
  if (hasGit) {
    // Before install, so Husky's `prepare` script can install the hooks.
    await run('git', ['init', '-q', '-b', 'main'], targetDir).catch(() =>
      run('git', ['init', '-q'], targetDir),
    );
  }

  let installed = false;
  if (options.install) {
    if (await commandExists(packageManager)) {
      s.start(`Installing dependencies with ${packageManager} — this takes a few minutes`);
      try {
        await run(packageManager, ['install'], targetDir);
        installed = true;
        s.stop('Dependencies installed');
      } catch (error) {
        s.error(`${packageManager} install failed — run it yourself to see why`);
        if (process.env.DEBUG) console.error(error);
      }
    } else {
      p.log.warn(`${packageManager} isn't installed — skipping dependency install.`);
    }
  }

  if (hasGit) {
    try {
      await run('git', ['add', '-A'], targetDir);
      // --no-verify: the pre-commit hook blocks commits to main by design.
      await run(
        'git',
        ['commit', '-q', '--no-verify', '-m', 'chore: initial commit from create-expo-boilerplate'],
        targetDir,
      );
    } catch {
      p.log.warn('Skipped the initial commit (is git user.name / user.email set?).');
    }
  }

  // ── Next steps ───────────────────────────────────────────
  const cmd = PM[packageManager];
  const rel = relative(process.cwd(), targetDir) || '.';
  const steps = [
    rel !== '.' ? `cd ${rel}` : null,
    installed ? null : cmd.install,
    '$EDITOR .env.development   # add your API URLs',
    `${cmd.run} android:development   # or ios:development`,
  ].filter(Boolean);

  p.note(steps.join('\n'), 'Next steps');
  p.outro(
    `${pc.dim('Stack:')} ${[
      state === 'redux' ? `Redux Toolkit + ${reduxMiddleware}` : 'Zustand',
      navigation === 'expo-router' ? 'Expo Router' : 'React Navigation',
      STYLING_LABEL[styling],
      language === 'ts' ? 'TypeScript' : 'JavaScript',
      eslint ? 'ESLint' : null,
      husky ? 'Husky' : null,
    ]
      .filter(Boolean)
      .join(' · ')}`,
  );
}

program.parseAsync().catch((error: unknown) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
