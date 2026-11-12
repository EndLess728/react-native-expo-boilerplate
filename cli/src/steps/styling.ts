import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectOptions } from '../options.js';
import { OVERLAYS_DIR } from '../template.js';
import type { ProjectFiles } from '../utils/files.js';
import type { PackageJsonEditor } from '../utils/packageJson.js';
import { pick } from '../versions.js';

/** Unistyles-only blocks in config files, marked `// @cli:unistyles-start/end`. */
const UNISTYLES_REGION_FILES = [
  'index.ts',
  'babel.config.js',
  'eslint.config.js',
  'src/styles/themes.ts',
  'jest.setup.ts',
];

/**
 * Styling-specific sections of `.skills/ui-creation.md`. Each overlay ships a
 * replacement for every one of them in `docs/<region>.md`.
 */
const DOC_REGIONS = [
  'ui-intro',
  'ui-styling',
  'ui-wrapper-example',
  'ui-wrapper-style-prop',
  'ui-wrapper-layout-rule',
  'ui-avoid-style',
  'ui-avoid-theme',
  'ui-checklist',
];

const DOCS = '.skills/ui-creation.md';
const SNIPPETS = '.vscode/project.code-snippets';

/**
 * Unistyles is the base template; plain StyleSheet and Tailwind (Uniwind) are
 * overlays that replace every styled file. Runs after the navigation step, so
 * the entry file and root component it edits are the final ones.
 */
export async function applyStyling(
  files: ProjectFiles,
  pkg: PackageJsonEditor,
  options: ProjectOptions,
): Promise<void> {
  if (options.styling === 'unistyles') {
    for (const rel of UNISTYLES_REGION_FILES) await files.region(rel, 'unistyles');
    for (const name of DOC_REGIONS) await files.region(DOCS, name);
    await files.region(SNIPPETS, 'snippet-screen');
    return;
  }

  const dir = join(OVERLAYS_DIR, 'styling', options.styling);

  await files.remove('src/styles/unistyles.ts', 'src/styles/breakpoints.ts');
  await files.overlay(join(dir, 'common'));
  // The route files only exist with Expo Router; React Navigation deletes src/app.
  if (options.navigation === 'expo-router') await files.overlay(join(dir, 'expo-router'));

  for (const rel of UNISTYLES_REGION_FILES) await files.region(rel, 'unistyles', '');
  pkg.removeDeps('react-native-unistyles', 'eslint-plugin-react-native-unistyles');
  await files.replace(
    'jest.config.js',
    'react-native-unistyles|',
    options.styling === 'tailwind' ? 'uniwind|' : '',
  );

  if (options.styling === 'tailwind') {
    // Text roles and fonts are Tailwind classes defined in global.css.
    await files.remove('src/theme/TextStyles.ts');
    pkg.addDeps(pick('uniwind', 'tailwindcss'));
    // Uniwind's docs: import the stylesheet from the root component, not the
    // entry file, or every CSS edit triggers a full reload instead of HMR.
    if (options.navigation === 'expo-router') {
      await files.replace(
        'src/app/_layout.tsx',
        "import React from 'react';",
        "import '../../global.css';\n\nimport React from 'react';",
      );
    } else {
      await files.replace(
        'src/App.tsx',
        "import React from 'react';",
        "import '../global.css';\n\nimport React from 'react';",
      );
    }
  }

  // AI-assistant docs and editor snippets.
  for (const name of DOC_REGIONS) {
    await files.region(DOCS, name, await readFile(join(dir, 'docs', `${name}.md`), 'utf8'));
  }
  await files.replace(
    DOCS,
    '  theme/                   ← TextStyles, fonts (typography only)\n  styles/                  ← unistyles config, themes (light/dark), breakpoints\n',
    await readFile(join(dir, 'docs', 'ui-tree.md'), 'utf8'),
  );
  await files.region(
    SNIPPETS,
    'snippet-screen',
    await readFile(join(dir, 'docs', 'snippet-screen.jsonc'), 'utf8'),
  );
}
