import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProjectFiles } from './utils/files.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the published package (`cli/` in the repo). */
export const PACKAGE_ROOT = resolve(here, '..');
export const OVERLAYS_DIR = join(PACKAGE_ROOT, 'overlays');
const PACKAGED_TEMPLATE_DIR = join(PACKAGE_ROOT, 'template');
/** The boilerplate itself — the repo root, one level above `cli/`. */
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');

// npm drops `.gitignore` (and `.npmrc`) from published tarballs, so the
// packaged template stores them under these names and they're renamed back on copy.
export const RENAMED_DOTFILES: Record<string, string> = {
  '.gitignore': '_gitignore',
  '.npmrc': '_npmrc',
};

/** Repo files that belong to the boilerplate repo itself, not to generated apps. */
const EXCLUDED = [
  /^cli\//,
  /^\.github\//,
  /^README\.md$/, // every generated project gets its own README
  /^LICENSE$/, // the boilerplate's license; a generated app is its owner's to license
  /^docs\//, // guides for this repo's own stack and CI; generated apps get a README for theirs
  /^website\//, // the documentation site (GitHub Pages), not part of an app
  /^\.env\.(development|staging|production)$/, // seeded from .env.example on install
  /^\.env(\.local)?$/,
];

/** Files of the boilerplate repo that make up the template (tracked + untracked-not-ignored). */
export function listRepoTemplateFiles(repoRoot = REPO_ROOT): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  return out
    .split('\0')
    .filter(Boolean)
    .filter((file) => !EXCLUDED.some((re) => re.test(file)))
    .filter((file) => existsSync(join(repoRoot, file))) // skip deleted-but-unstaged
    .sort();
}

/**
 * Copies the base template into `targetDir`.
 *
 * Uses the template bundled into the npm package when present; otherwise (when
 * running from a checkout of the boilerplate repo) copies straight from the
 * repo root, so the CLI always generates from the current boilerplate.
 */
export async function copyBaseTemplate(targetDir: string): Promise<void> {
  const packaged = existsSync(PACKAGED_TEMPLATE_DIR);
  const sourceRoot = packaged ? PACKAGED_TEMPLATE_DIR : REPO_ROOT;
  const files = packaged
    ? await new ProjectFiles(PACKAGED_TEMPLATE_DIR).list()
    : listRepoTemplateFiles(REPO_ROOT);

  const restore = Object.fromEntries(
    Object.entries(RENAMED_DOTFILES).map(([real, stored]) => [stored, real]),
  );

  for (const file of files) {
    const parts = file.split('/');
    const base = parts[parts.length - 1];
    if (packaged && restore[base]) parts[parts.length - 1] = restore[base];
    const dest = join(targetDir, ...parts);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(sourceRoot, ...file.split('/')), dest);
  }

  await stripRepoOnlyConfig(new ProjectFiles(targetDir));
}

/** The boilerplate repo's configs exclude `cli/`; generated apps have no such folder. */
async function stripRepoOnlyConfig(files: ProjectFiles): Promise<void> {
  await files.replace('tsconfig.json', ',\n    "website",\n    "cli"\n', '\n');
  await files.replace(
    'jest.config.js',
    /\n {2}\/\/ `cli\/` is the create-expo-boilerplate package[\s\S]*?modulePathIgnorePatterns: \['<rootDir>\/cli\/', '<rootDir>\/website\/'\],/,
    '',
  );
  await files.replace('eslint.config.js', "      '**/cli/*',\n      '**/website/*',\n", '', { optional: true });
}
