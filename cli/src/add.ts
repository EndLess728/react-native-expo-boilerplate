import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as p from '@clack/prompts';
import pc from 'picocolors';

import { loadManifest, isBoilerplateProject, saveManifest } from './manifest.js';
import { MODULES } from './modules/index.js';
import { CancelledError, Patcher } from './modules/types.js';
import { formatFiles } from './steps/format.js';
import { transpileFiles } from './steps/javascript.js';
import type { PackageManager } from './options.js';
import { detectPackageManager, PM } from './steps/packageManager.js';
import { commandExists, run } from './utils/exec.js';
import { ProjectFiles } from './utils/files.js';
import { PackageJsonEditor } from './utils/packageJson.js';

export interface AddFlags {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  install: boolean;
  [moduleFlag: string]: unknown;
}

/** Never copied into the staging area — large, generated, or not ours to touch. */
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', '.expo', 'dist', 'web-build']);

async function isDirty(dir: string): Promise<boolean | null> {
  try {
    return (await run('git', ['status', '--porcelain'], dir)).trim() !== '';
  } catch {
    return null; // not a git repo
  }
}

/** Files that differ between the staging copy and the project: added/changed, and removed. */
async function diff(project: ProjectFiles, staged: ProjectFiles) {
  const before = new Set(await listOwn(project));
  const after = await listOwn(staged);
  const changed: string[] = [];
  for (const rel of after) {
    if (!before.has(rel)) changed.push(rel);
    else if (!(await readFile(project.abs(rel))).equals(await readFile(staged.abs(rel)))) {
      changed.push(rel);
    }
  }
  const removed = [...before].filter((rel) => !after.includes(rel));
  return { changed, removed, created: changed.filter((rel) => !before.has(rel)) };
}

async function listOwn(files: ProjectFiles): Promise<string[]> {
  return (await files.list()).filter((rel) => !SKIP.has(rel.split('/')[0]));
}

export async function addModule(
  name: string | undefined,
  flags: AddFlags,
  cliVersion: string,
): Promise<void> {
  const cwd = process.cwd();
  const interactive = !flags.yes && Boolean(process.stdout.isTTY);

  console.log();
  p.intro(pc.bgCyan(pc.black(' create-expo-boilerplate add ')));

  // ── Which module ─────────────────────────────────────────
  if (!name) {
    if (!interactive) throw new Error(`Name a module: ${Object.keys(MODULES).join(', ')}.`);
    const picked = await p.select({
      message: 'Which module?',
      options: Object.values(MODULES).map((m) => ({
        value: m.name,
        label: m.name,
        hint: m.description,
      })),
    });
    if (p.isCancel(picked)) return cancelled();
    name = picked;
  }
  const mod = MODULES[name];
  if (!mod)
    throw new Error(`Unknown module "${name}". Available: ${Object.keys(MODULES).join(', ')}.`);

  // ── Preflight ────────────────────────────────────────────
  const project = new ProjectFiles(cwd);
  if (!isBoilerplateProject(project)) {
    throw new Error(
      "This doesn't look like a create-expo-boilerplate project. Run `add` from the project root.",
    );
  }
  const { manifest, detected } = await loadManifest(project);
  if (manifest.modules[mod.name] || project.exists(`src/${mod.name}`)) {
    throw new Error(`${mod.name} is already in this project (src/${mod.name}/).`);
  }
  if (detected) {
    p.log.warn(
      `No boilerplate.json — detected ${manifest.navigation}, ${manifest.styling}, ${manifest.state}, ${manifest.language.toUpperCase()}. It will be written now.`,
    );
  } else if (manifest.cliVersion !== cliVersion) {
    p.log.warn(
      `This project was created with v${manifest.cliVersion}; this is v${cliVersion}. If anything doesn't fit, run ${pc.bold(`npx create-expo-boilerplate@${manifest.cliVersion} add ${mod.name}`)}.`,
    );
  }
  const dirty = await isDirty(cwd);
  if (dirty && !flags.force && !flags.dryRun) {
    throw new Error(
      'You have uncommitted changes. Commit or stash them first (or pass --force), so the module lands as one reviewable diff.',
    );
  }
  if (dirty === null) p.log.warn("Not a git repository — you won't get a diff to review.");

  // ── Generate into a staging copy ─────────────────────────
  // Nothing touches the project until everything succeeded, which also makes
  // --dry-run exact.
  const stagingDir = await mkdtemp(join(tmpdir(), 'ceb-add-'));
  let nextSteps: string[] = [];
  let manual: string[] = [];
  try {
    await cp(cwd, stagingDir, {
      recursive: true,
      filter: (src) => !SKIP.has(relative(cwd, src).split(sep)[0]),
    });
    const staged = new ProjectFiles(stagingDir);
    const pkg = await PackageJsonEditor.load(staged);
    const patch = new Patcher(staged);

    try {
      nextSteps = await mod.apply(
        { files: staged, pkg, stack: manifest, patch, interactive, cwd },
        flags,
      );
    } catch (error) {
      if (error instanceof CancelledError) return cancelled();
      throw error;
    }
    await pkg.save();
    manual = patch.manual;

    if (manifest.language === 'js') {
      const created = (await diff(project, staged)).created;
      await transpileFiles(
        staged,
        created.filter((rel) => /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts')),
      );
    }
    manifest.modules[mod.name] = { cliVersion };
    await saveManifest(staged, manifest);

    const { changed, removed, created } = await diff(project, staged);
    // Module sources ship formatted with the template's Prettier. Re-formatting
    // them with another version can disagree with the project's ESLint, so only
    // edited files and freshly transpiled JS are formatted.
    const toFormat =
      manifest.language === 'js' ? changed : changed.filter((rel) => !created.includes(rel));
    await formatFiles(staged, toFormat, await projectPrettier(cwd));

    // ── Report / write ─────────────────────────────────────
    p.note(
      [
        ...changed.map((rel) => `${created.includes(rel) ? pc.green('+') : pc.yellow('~')} ${rel}`),
        ...removed.map((rel) => `${pc.red('-')} ${rel}`),
      ].join('\n'),
      flags.dryRun ? 'Would change' : 'Changes',
    );

    if (flags.dryRun) {
      if (patch.manual.length)
        p.note(patch.manual.map((m) => `• ${m}`).join('\n'), 'Would need doing by hand');
      p.outro('Dry run — nothing was written.');
      return;
    }

    for (const rel of changed) {
      await project.write(rel, '');
      await cp(staged.abs(rel), project.abs(rel));
    }
    await project.remove(...removed);
    await eslintFix(project, changed);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  // ── Install ──────────────────────────────────────────────
  const pm = projectPackageManager(project);
  let installed = false;
  if (flags.install) {
    if (await commandExists(pm)) {
      const s = p.spinner();
      s.start(`Installing dependencies with ${pm}`);
      try {
        await run(pm, ['install'], cwd);
        installed = true;
        s.stop('Dependencies installed');
      } catch (error) {
        s.error(`${pm} install failed — run it yourself to see why`);
        if (process.env.DEBUG) console.error(error);
      }
    } else {
      p.log.warn(`${pm} isn't installed — skipping dependency install.`);
    }
  }

  // ── What's left ──────────────────────────────────────────
  if (manual.length) {
    p.note(manual.map((m) => `• ${m}`).join('\n'), pc.yellow("Couldn't patch — do these by hand"));
  }
  const steps = [installed ? null : PM[pm].install, ...nextSteps].filter(Boolean);
  p.note(steps.map((step, i) => `${i + 1}. ${step}`).join('\n'), 'Next steps');
  p.outro(`${pc.green('✔')} Added ${pc.bold(mod.name)} — docs in src/${mod.name}/README.md`);
}

function projectPackageManager(project: ProjectFiles): PackageManager {
  const byLockfile = (Object.keys(PM) as PackageManager[]).find((pm) =>
    project.exists(PM[pm].lockfile),
  );
  return byLockfile ?? detectPackageManager() ?? 'yarn';
}

/**
 * Runs the project's own ESLint autofix over the files `add` touched, when it
 * is installed — import/export order rules depend on the final file (after the
 * JS pass), which only the project's config can judge. Best effort.
 */
async function eslintFix(project: ProjectFiles, changed: string[]): Promise<void> {
  const bin = project.abs('node_modules/.bin/eslint');
  const targets = changed.filter((rel) => /\.(jsx?|tsx?)$/.test(rel));
  if (!existsSync(bin) || !project.exists('eslint.config.js') || !targets.length) return;
  try {
    await run(bin, ['--fix', '--no-warn-ignored', ...targets], project.root);
  } catch {
    // Remaining problems are the project's lint to report, not a failed add.
  }
}

/** The project's installed Prettier, if any (see `formatFiles`). */
async function projectPrettier(cwd: string) {
  try {
    const entry = createRequire(join(cwd, 'package.json')).resolve('prettier');
    const mod = await import(pathToFileURL(entry).href);
    // The CommonJS entry puts the API under `default`.
    const api = typeof mod.format === 'function' ? mod : mod.default;
    return typeof api?.format === 'function' ? api : undefined;
  } catch {
    return undefined;
  }
}

function cancelled(): void {
  p.cancel('Cancelled — nothing was changed.');
}
