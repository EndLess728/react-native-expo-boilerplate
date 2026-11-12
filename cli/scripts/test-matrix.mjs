#!/usr/bin/env node
/**
 * Generates every supported option combination and checks each one compiles,
 * lints and passes its tests.
 *
 *   node scripts/test-matrix.mjs            # core set (stacks × languages, styling options, tooling toggles)
 *   node scripts/test-matrix.mjs --all      # every combination (144)
 *   node scripts/test-matrix.mjs --export   # also bundle each project with `expo export` (slow)
 *   node scripts/test-matrix.mjs --only redux-saga.react-navigation.tailwind.ts
 *   node scripts/test-matrix.mjs --add notifications   # also run `add <module>` on each project
 *
 * Dependencies are installed ONCE: the union of every generated package.json
 * goes into .matrix/deps, and each project symlinks its node_modules to it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
// Outside the repo, so Metro / Jest / tsc in the boilerplate never crawl it.
const matrixDir = process.env.MATRIX_DIR ?? join(tmpdir(), 'create-expo-boilerplate-matrix');
const depsDir = join(matrixDir, 'deps');
const args = process.argv.slice(2);
const all = args.includes('--all');
const doExport = args.includes('--export');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const addModules = args.flatMap((arg, i) => (arg === '--add' ? [args[i + 1]] : []));

// ── Combinations ───────────────────────────────────────────
const STATES = [
  { id: 'zustand', flags: ['--state', 'zustand'] },
  { id: 'redux-thunk', flags: ['--state', 'redux', '--redux-middleware', 'thunk'] },
  { id: 'redux-saga', flags: ['--state', 'redux', '--redux-middleware', 'saga'] },
];
const NAVS = ['expo-router', 'react-navigation'];
const STYLES = ['unistyles', 'stylesheet', 'tailwind'];
const LANGS = ['ts', 'js'];
const TOOLING = [
  { id: 'eslint-husky', eslint: true, husky: true },
  { id: 'husky', eslint: false, husky: true },
  { id: 'eslint', eslint: true, husky: false },
  { id: 'bare', eslint: false, husky: false },
];

const combos = [];
for (const state of STATES)
  for (const nav of NAVS)
    for (const styling of STYLES)
      for (const lang of LANGS)
        for (const tooling of TOOLING) {
          // Core set: every state × navigation stack with full tooling, every
          // styling option on both navigators (styling overlays don't touch
          // state code), plus the tooling toggles on the base stack — they
          // only touch config files, not app code.
          const base = state.id === 'zustand' && nav === 'expo-router' && styling === 'unistyles';
          const core =
            (tooling.id === 'eslint-husky' &&
              (styling === 'unistyles' || state.id === 'zustand')) ||
            base;
          if (!all && !core) continue;
          const id = `${state.id}.${nav}.${styling}.${lang}.${tooling.id}`;
          if (only && !id.startsWith(only)) continue;
          combos.push({ ...tooling, id, state, nav, styling, lang });
        }

// ── Helpers ────────────────────────────────────────────────
function sh(cmd, cmdArgs, cwd, { quiet = true, env = {} } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', FORCE_COLOR: '0', ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

// Leftovers that must never reach a generated project.
async function leftovers(dir, combo) {
  const problems = [];
  const bad = [/@cli:/, /__cli_blank_line__/];
  if (combo.nav === 'react-navigation') bad.push(/from 'expo-router'/);
  if (combo.state.id !== 'zustand') bad.push(/from 'zustand/, /useUserStore/);
  if (combo.styling !== 'unistyles') bad.push(/react-native-unistyles/, /@\/styles\/unistyles/);
  if (combo.styling !== 'tailwind') bad.push(/className=/);
  for (const file of await walk(dir)) {
    if (!/\.(jsx?|tsx?|json)$/.test(file)) continue;
    if (combo.lang === 'js' && /\.tsx?$/.test(file))
      problems.push(`TS file in JS project: ${file}`);
    const text = await readFile(file, 'utf8');
    for (const re of bad)
      if (re.test(text)) problems.push(`${re} in ${file.slice(dir.length + 1)}`);
  }
  return problems;
}

// ── 1. Build + generate ────────────────────────────────────
console.log('Building CLI…');
if (!sh('npx', ['tsc', '-p', 'tsconfig.json'], cliRoot).ok) {
  console.error('CLI build failed');
  process.exit(1);
}

await mkdir(matrixDir, { recursive: true });
console.log(`Generating ${combos.length} projects…`);
for (const combo of combos) {
  const dir = join(matrixDir, combo.id);
  await rm(dir, { recursive: true, force: true });
  const flags = [
    ...combo.state.flags,
    '--navigation',
    combo.nav,
    '--styling',
    combo.styling,
    '--language',
    combo.lang,
    combo.eslint ? '--eslint' : '--no-eslint',
    combo.husky ? '--husky' : '--no-husky',
    '--pm',
    'yarn',
    '--yes',
    '--no-install',
    '--no-git',
  ];
  const res = sh('node', [join(cliRoot, 'dist/index.js'), combo.id, ...flags], matrixDir);
  if (!res.ok) {
    console.error(`✖ generate ${combo.id}\n${res.out}`);
    process.exit(1);
  }
}

// ── 2. One shared install (union of all dependencies) ──────
// The base template's dependencies plus every package an overlay can add, so
// the install is identical whichever combinations are being checked.
const { VERSIONS } = await import(join(cliRoot, 'dist/versions.js'));
const rootPkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const union = {
  dependencies: { ...rootPkg.dependencies, ...VERSIONS },
  devDependencies: rootPkg.devDependencies,
};
const depsPkg = { name: 'matrix-deps', private: true, ...union };
const hash = createHash('sha1').update(JSON.stringify(depsPkg)).digest('hex');
const stamp = join(depsDir, '.hash');
const cached = existsSync(stamp) && (await readFile(stamp, 'utf8')) === hash;
if (!cached) {
  console.log('Installing the shared dependency superset (one-time)…');
  await mkdir(depsDir, { recursive: true });
  await writeFile(join(depsDir, 'package.json'), JSON.stringify(depsPkg, null, 2));
  await copyFile(join(repoRoot, 'yarn.lock'), join(depsDir, 'yarn.lock'));
  const res = sh(
    'yarn',
    ['install', '--ignore-scripts', '--non-interactive', '--network-timeout', '600000'],
    depsDir,
    {
      quiet: false,
    },
  );
  if (!res.ok) process.exit(1);
  await writeFile(stamp, hash);
}

// ── 3. Checks ──────────────────────────────────────────────
const results = [];
check: for (const combo of combos) {
  const dir = join(matrixDir, combo.id);
  const link = join(dir, 'node_modules');
  await rm(link, { recursive: true, force: true });
  await symlink(join(depsDir, 'node_modules'), link, 'dir');
  // The app config validates env vars; give it the example values.
  await copyFile(join(dir, '.env.example'), join(dir, '.env.development'));

  // After node_modules is linked, like a real project: `add` uses its Prettier and ESLint.
  for (const mod of addModules) {
    const added = sh(
      'node',
      [join(cliRoot, 'dist/index.js'), 'add', mod, '--yes', '--no-install'],
      dir,
    );
    if (!added.ok || /by hand/.test(added.out)) {
      console.error(`✖ add ${mod} to ${combo.id}\n${added.out}`);
      results.push({ id: combo.id, ok: false, checks: [] });
      continue check;
    }
    // Running it again must refuse, not duplicate the wiring.
    if (sh('node', [join(cliRoot, 'dist/index.js'), 'add', mod, '--yes', '--no-install'], dir).ok) {
      console.error(`✖ add ${mod} twice to ${combo.id} succeeded`);
      results.push({ id: combo.id, ok: false, checks: [] });
      continue check;
    }
  }

  const checks = [];
  const problems = await leftovers(dir, combo);
  checks.push(['leftovers', problems.length === 0, problems.join('\n')]);
  if (combo.lang === 'ts') {
    checks.push(['tsc', ...Object.values(sh('npx', ['tsc', '--noEmit'], dir))]);
    checks.push([
      'cycles',
      ...Object.values(
        sh(
          'npx',
          [
            '-y',
            'madge@8',
            '--circular',
            '--extensions',
            'ts,tsx',
            '--ts-config',
            'tsconfig.json',
            'src',
            'index.ts',
          ],
          dir,
        ),
      ),
    ]);
  }
  if (combo.eslint)
    checks.push([
      'eslint',
      ...Object.values(sh('npx', ['eslint', '.', '--max-warnings', '0'], dir)),
    ]);
  else checks.push(['prettier', ...Object.values(sh('npx', ['prettier', '--check', 'src'], dir))]);
  checks.push(['jest', ...Object.values(sh('npx', ['jest', '--ci', '--silent'], dir))]);
  checks.push(['expo config', ...Object.values(sh('npx', ['expo', 'config', '--json'], dir))]);
  if (doExport) {
    checks.push([
      'expo export',
      ...Object.values(
        sh(
          'npx',
          ['expo', 'export', '--platform', 'android', '--output-dir', join(dir, 'dist-export')],
          dir,
          {
            // The shared node_modules contains expo-router too; a real React
            // Navigation project doesn't, so silence Expo's mixed-setup guard.
            env:
              combo.nav === 'react-navigation'
                ? { EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK: '1' }
                : {},
          },
        ),
      ),
    ]);
  }

  const ok = checks.every(([, pass]) => pass);
  results.push({ id: combo.id, ok, checks });
  console.log(
    `${ok ? '✔' : '✖'} ${combo.id}  ${checks.map(([n, pass]) => `${pass ? '' : '!'}${n}`).join(' ')}`,
  );
  for (const [name, pass, out] of checks) {
    if (!pass) console.log(`--- ${name} ---\n${out.trim().split('\n').slice(-40).join('\n')}\n`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} combinations passed.`);
process.exit(failed.length ? 1 : 0);
