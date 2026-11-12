import * as prettier from 'prettier';

import type { ProjectFiles } from '../utils/files.js';

const CODE_RE = /\.(jsx?|tsx?|mjs|cjs)$/;
const JSON_FILES = ['package.json', 'eas.json', 'jsconfig.json', 'tsconfig.json'];

/**
 * Runs Prettier with the project's own .prettierrc over code and the JSON
 * files the CLI rewrote, so overlays, transpiled JS and edited configs match
 * the house style. The base template is already formatted, so this is a no-op
 * for files nobody touched.
 */
export async function formatProject(files: ProjectFiles): Promise<void> {
  const targets = (await files.list()).filter(
    (rel) => (CODE_RE.test(rel) && !rel.startsWith('scripts/')) || JSON_FILES.includes(rel),
  );
  await formatFiles(files, targets);
}

/**
 * Prettier over `rels` (code and JSON only), with the project's own config.
 * Pass the project's own Prettier when it has one installed: another version
 * can format the same code differently, and the project's ESLint would flag it.
 */
export async function formatFiles(
  files: ProjectFiles,
  rels: string[],
  engine: Pick<typeof prettier, 'format' | 'resolveConfig'> = prettier,
): Promise<void> {
  const config = (await engine.resolveConfig(files.abs('.prettierrc'))) ?? {};
  const targets = rels.filter((rel) => CODE_RE.test(rel) || rel.endsWith('.json'));

  for (const rel of targets) {
    const source = await files.read(rel);
    const formatted = await engine.format(source, { ...config, filepath: files.abs(rel) });
    if (formatted !== source) await files.write(rel, formatted);
  }
}
