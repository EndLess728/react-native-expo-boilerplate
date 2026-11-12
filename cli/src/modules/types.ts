import type { Stack } from '../manifest.js';
import type { ProjectFiles } from '../utils/files.js';
import type { PackageJsonEditor } from '../utils/packageJson.js';

/** Thrown when the user cancels a prompt. */
export class CancelledError extends Error {}

/** Edits to files the user owns, with a manual fallback when one no longer matches. */
export class Patcher {
  /** Instructions for edits that couldn't be applied automatically. */
  readonly manual: string[] = [];

  constructor(private readonly files: ProjectFiles) {}

  /** The first of `candidates` that exists (e.g. `index.ts` / `index.js`). */
  find(...candidates: string[]): string | null {
    return candidates.find((rel) => this.files.exists(rel)) ?? null;
  }

  /**
   * Applies `edit` to `rel`. `edit` returns the new content, or `null` when its
   * anchor isn't there (the file was customised) — then `manual` is recorded
   * for the user instead of guessing. Returns whether the edit was applied.
   */
  async edit(
    rel: string | null,
    edit: (source: string) => string | null,
    manual: string,
  ): Promise<boolean> {
    if (!rel || !this.files.exists(rel)) {
      this.manual.push(manual);
      return false;
    }
    const source = await this.files.read(rel);
    const next = edit(source);
    if (next === null) {
      this.manual.push(`${rel}: ${manual}`);
      return false;
    }
    if (next !== source) await this.files.write(rel, next);
    return true;
  }

  /** Inserts `text` before the first match of `anchor`, unless `text` is already present. */
  insertBefore(rel: string | null, anchor: RegExp, text: string, manual: string) {
    return this.edit(
      rel,
      (src) => {
        if (src.includes(text.trim())) return src;
        const match = anchor.exec(src);
        return match ? src.slice(0, match.index) + text + src.slice(match.index) : null;
      },
      manual,
    );
  }

  /** Inserts `text` after the first match of `anchor`, unless `text` is already present. */
  insertAfter(rel: string | null, anchor: RegExp, text: string, manual: string) {
    return this.edit(
      rel,
      (src) => {
        if (src.includes(text.trim())) return src;
        const match = anchor.exec(src);
        if (!match) return null;
        const end = match.index + match[0].length;
        return src.slice(0, end) + text + src.slice(end);
      },
      manual,
    );
  }
}

export interface ModuleContext {
  /** A staging copy of the project; nothing touches the real one until the end. */
  files: ProjectFiles;
  pkg: PackageJsonEditor;
  stack: Stack;
  patch: Patcher;
  /** Prompts are allowed (a TTY, and no `--yes`). */
  interactive: boolean;
  /** The user's project directory (for resolving paths they type). */
  cwd: string;
}

export interface ModuleGenerator {
  name: string;
  description: string;
  /** Extra `add` flags this module understands, for `--help`. */
  flags: { flags: string; description: string }[];
  /**
   * Writes the module into `ctx.files`. New source files are written in
   * TypeScript — `add` transpiles them for JavaScript projects. Returns the
   * steps the user still has to do by hand.
   */
  apply(ctx: ModuleContext, flags: Record<string, unknown>): Promise<string[]>;
}
