import ts from 'typescript';

import type { ProjectOptions } from '../options.js';
import type { ProjectFiles } from '../utils/files.js';
import type { PackageJsonEditor } from '../utils/packageJson.js';

/*
 * TypeScript → JavaScript.
 *
 * The template is written once, in TypeScript. For JS projects every .ts/.tsx
 * file is transpiled with the TypeScript compiler (types erased, type-only
 * imports dropped, JSX left untouched), then formatted by Prettier in the
 * format step. Files that only contained types end up empty; they're deleted
 * along with every import / re-export that pointed at them.
 */

// The TS emitter drops blank lines between statements. They are restored by
// aligning output lines with source lines: type erasure only ever deletes
// characters, so every emitted line is a subsequence of its source line.
// Wherever two adjacent output lines came from source lines that had a blank
// line between them, the blank line goes back in.
const squash = (line: string) => line.replace(/\s+/g, '');

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return false;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
}

export function restoreBlankLines(source: string, output: string): string {
  const src = source.split('\n');
  const srcIdx = src.map((_, i) => i).filter((i) => src[i].trim() !== '');
  const srcText = srcIdx.map((i) => squash(src[i]));
  const out = output.split('\n');
  const outIdx = out.map((_, i) => i).filter((i) => out[i].trim() !== '');
  const outText = outIdx.map((i) => squash(out[i]));

  // Longest common subsequence where "equal" means "output line is a
  // subsequence of the source line" (exact matches preferred via the DP).
  const n = outText.length;
  const m = srcText.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      dp[a][b] = isSubsequence(outText[a], srcText[b])
        ? dp[a + 1][b + 1] + 1
        : Math.max(dp[a + 1][b], dp[a][b + 1]);
    }
  }
  const sourceLineOf = new Map<number, number>(); // output line → source line
  for (let a = 0, b = 0; a < n && b < m; ) {
    if (isSubsequence(outText[a], srcText[b]) && dp[a][b] === dp[a + 1][b + 1] + 1) {
      sourceLineOf.set(outIdx[a], srcIdx[b]);
      a++;
      b++;
    } else if (dp[a + 1][b] >= dp[a][b + 1]) a++;
    else b++;
  }

  const result: string[] = [];
  let prev = -1; // previous non-blank output line
  for (let k = 0; k < out.length; k++) {
    const line = out[k];
    if (line.trim() !== '' && prev >= 0 && out[k - 1].trim() !== '') {
      const from = sourceLineOf.get(prev);
      const to = sourceLineOf.get(k);
      if (from !== undefined && to !== undefined && to > from) {
        const hadBlank = src.slice(from + 1, to).some((l) => l.trim() === '');
        if (hadBlank) result.push('');
      }
    }
    result.push(line);
    if (line.trim() !== '') prev = k;
  }
  return result.join('\n');
}

export function transpile(source: string, fileName: string): string {
  const { outputText } = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      removeComments: false,
      verbatimModuleSyntax: false,
      isolatedModules: true,
      esModuleInterop: true,
    },
  });
  return restoreBlankLines(source, outputText.replace(/^export \{\};?\s*$/m, ''));
}

/** True when nothing but comments and whitespace is left. */
function isEffectivelyEmpty(code: string): boolean {
  return (
    code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim() === ''
  );
}

const jsName = (rel: string) => rel.replace(/\.tsx$/, '.jsx').replace(/\.ts$/, '.js');

/** Resolves an import specifier to a project-relative module path without extension. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else if (spec === '@env') base = 'env';
  else if (spec.startsWith('.')) {
    const dir = fromFile.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') dir.pop();
      else dir.push(part);
    }
    base = dir.join('/');
  } else return null;
  return base;
}

// `import … from '…'`, `export … from '…'` (possibly multi-line) and `import '…'`.
const FROM_STATEMENT_RE = /^(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"];?[ \t]*\n?/gm;
const SIDE_EFFECT_IMPORT_RE = /^import\s*['"]([^'"]+)['"];?[ \t]*\n?/gm;

/**
 * Transpiles `sources` (.ts/.tsx, project-relative) to .js/.jsx in place.
 * Files that only held types are deleted, along with every import / re-export
 * among `sources` that pointed at them. Used for whole projects and for the
 * files a module adds to a JavaScript project.
 */
export async function transpileFiles(files: ProjectFiles, sources: string[]): Promise<void> {
  const output = new Map<string, string>(); // new path → code
  const emptied = new Set<string>(); // old path without extension

  for (const rel of sources) {
    const code = transpile(await files.read(rel), rel);
    const stem = rel.replace(/\.tsx?$/, '');
    if (isEffectivelyEmpty(code)) emptied.add(stem);
    else output.set(jsName(rel), code);
    await files.remove(rel);
  }

  const pointsAtEmptied = (fromFile: string, spec: string) => {
    const base = resolveSpecifier(fromFile, spec);
    return base !== null && (emptied.has(base) || emptied.has(`${base}/index`));
  };
  for (const [rel, code] of output) {
    const drop = (statement: string, spec: string) => (pointsAtEmptied(rel, spec) ? '' : statement);
    const cleaned = code.replace(FROM_STATEMENT_RE, drop).replace(SIDE_EFFECT_IMPORT_RE, drop);
    await files.write(rel, cleaned);
  }
}

export async function convertToJavaScript(
  files: ProjectFiles,
  pkg: PackageJsonEditor,
  options: ProjectOptions,
): Promise<void> {
  const all = await files.list();

  // 1. Declaration files carry nothing at runtime.
  await files.remove(...all.filter((f) => f.endsWith('.d.ts')));

  // 2–3. Transpile, and drop imports of modules that were types only.
  await transpileFiles(
    files,
    all.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts')),
  );

  // 4. Config that names TS files.
  await files.remove('tsconfig.json', 'tsconfig.test.json');
  await files.write(
    'jsconfig.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'], '@env': ['./env'] },
          jsx: 'react-native',
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          checkJs: false,
        },
        exclude: ['node_modules', 'android', 'ios'],
      },
      null,
      2,
    )}\n`,
  );

  await files.replace('jest.config.js', "'./jest.setup.ts'", "'./jest.setup.js'");
  await files.replace('jest.config.js', '__mocks__/@env.ts', '__mocks__/@env.js');
  await files.replace('jest.config.js', "'src/**/*.{ts,tsx}'", "'src/**/*.{js,jsx}'");
  await files.replace('jest.config.js', "    '!src/**/*.d.ts',\n", '');
  await files.replace('jest.config.js', "'!src/**/index.ts'", "'!src/**/index.js'");

  if (files.exists('.husky/pre-commit')) {
    await files.replace('.husky/pre-commit', /^.*\btype-check\s*\n/m, '');
  }

  pkg.data.main = './index.js';
  pkg.removeScripts('type-check').removeDeps('@types/*');
  // The ESLint TypeScript parser (pulled in by eslint-config-expo) still
  // needs the compiler; without ESLint nothing does.
  if (!options.eslint) pkg.removeDeps('typescript');
  const expoConfig = pkg.data.expo as { install?: { exclude?: string[] } } | undefined;
  if (expoConfig?.install?.exclude) {
    expoConfig.install.exclude = expoConfig.install.exclude.filter((p) => !p.startsWith('@types/'));
  }
}
