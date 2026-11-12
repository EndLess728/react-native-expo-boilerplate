import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ModuleContext, Patcher } from './types.js';

type Json = Record<string, unknown>;

/** Adds `source`'s keys to `target`, recursively. Existing values always win. */
export function deepMerge(target: Json, source: Json): Json {
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

/**
 * Merges `<moduleDir>/translations/<lang>.json` into every translation file the
 * project has. A language the module doesn't ship gets the English strings.
 */
export async function mergeTranslations({ files }: ModuleContext, moduleDir: string) {
  const dir = join(moduleDir, 'translations');
  const fallback = JSON.parse(await readFile(join(dir, 'en.json'), 'utf8'));
  for (const rel of await files.list('src/localization/translations')) {
    if (!rel.endsWith('.json')) continue;
    const lang = rel.split('/').pop()!.replace('.json', '');
    const own = join(dir, `${lang}.json`);
    const strings = existsSync(own) ? JSON.parse(await readFile(own, 'utf8')) : fallback;
    const merged = deepMerge(JSON.parse(await files.read(rel)), strings);
    await files.write(rel, `${JSON.stringify(merged, null, 2)}\n`);
  }
}

/**
 * Wraps the navigation root (`{children}` inside `<APIProvider>` in
 * AppProviders) in `<Tag>`, and imports it. Works whichever modules already
 * wrapped it: the new wrapper goes innermost.
 */
export async function wrapAppChildren(patch: Patcher, tag: string, from: string) {
  const providers = patch.find('src/providers/AppProviders.tsx', 'src/providers/AppProviders.jsx');
  const manual = `wrap the navigation root in \`<${tag}>\` (from \`${from}\`), inside \`<APIProvider>\`.`;
  const wrapped = await patch.edit(
    providers,
    (src) => {
      if (src.includes(`<${tag}>`)) return src;
      const re = /(<APIProvider>[\s\S]*?)\{children\}/;
      return re.test(src) ? src.replace(re, `$1<${tag}>{children}</${tag}>`) : null;
    },
    manual,
  );
  if (wrapped) {
    await patch.insertBefore(
      providers,
      /^import \{ APIProvider \}/m,
      `import { ${tag} } from '${from}';\n`,
      manual,
    );
  }
}

/**
 * React Navigation only: passes `src/navigation/navigationRef` to the
 * `NavigationContainer`, so code outside a screen can navigate. The ref file
 * itself comes from the module's react-navigation overlay.
 */
export async function wireNavigationRef(patch: Patcher, why: string) {
  const app = patch.find('src/App.tsx', 'src/App.jsx');
  const manual = `pass \`ref={navigationRef}\` (from \`@/navigation/navigationRef\`) to \`<NavigationContainer>\` so ${why}.`;
  const wired = await patch.edit(
    app,
    (src) =>
      src.includes('ref={navigationRef}')
        ? src
        : /<NavigationContainer(\s)/.test(src)
          ? src.replace(/<NavigationContainer(\s)/, '<NavigationContainer ref={navigationRef}$1')
          : null,
    manual,
  );
  if (wired) {
    await patch.insertBefore(
      app,
      /^import \{ AppProviders/m,
      "import { navigationRef } from '@/navigation/navigationRef';\n",
      manual,
    );
  }
}
