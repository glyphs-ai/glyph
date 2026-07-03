/**
 * Shared filesystem-walk helpers for the repo-wide architecture audits
 * (`inter-service-imports`, `tier-invisibility`, `split-convention`).
 * Centralises the recursive `readdirSync` traversal each audit
 * reimplemented so they share one definition of "what counts
 * as glyph source" and one skip policy.
 *
 * Two shapes:
 *   - `walkFiles` yields matching FILES under a root (the import audits).
 *   - `walkDirs` yields DIRECTORIES under a root (the split-convention
 *     classifier, which reasons about subdir shape rather than files).
 */

import { type Dirent, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Directories never descended into by the file/dir walks: vendored
 * deps, build output, and generated SQL migrations (none of which are
 * hand-authored glyph source).
 */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", "drizzle"]);

/** Matches a TypeScript / TSX source file by name. */
export function isTsFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

/** True iff `p` exists and is a directory. */
export function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface WalkFilesOptions {
  /** Directory names to skip (default {@link DEFAULT_SKIP_DIRS}). */
  readonly skipDirs?: ReadonlySet<string>;
  /** File-name predicate; only matching files are yielded (default: all). */
  readonly match?: (fileName: string) => boolean;
}

/**
 * Recursively yield every file under `dir` whose name satisfies
 * `match`, skipping any directory named in `skipDirs`. Traversal order
 * mirrors `readdirSync` order (directories recursed in place), so
 * callers that previously hand-rolled the same recursion observe the
 * same yield order.
 */
export function* walkFiles(dir: string, options: WalkFilesOptions = {}): Generator<string> {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const match = options.match ?? (() => true);
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue;
      yield* walkFiles(path.join(dir, e.name), options);
    } else if (e.isFile()) {
      if (match(e.name)) yield path.join(dir, e.name);
    }
  }
}

export interface WalkDirsOptions {
  /** Directory names to skip (default {@link DEFAULT_SKIP_DIRS}). */
  readonly skipDirs?: ReadonlySet<string>;
  /** When true, also skip directories whose name starts with `_`. */
  readonly skipUnderscore?: boolean;
}

/**
 * Recursively yield every directory under `dir` (pre-order: a directory
 * is yielded before its own children), skipping any directory named in
 * `skipDirs` and — when `skipUnderscore` is set — any directory whose
 * name starts with `_`.
 */
export function* walkDirs(dir: string, options: WalkDirsOptions = {}): Generator<string> {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (skipDirs.has(e.name)) continue;
    if (options.skipUnderscore === true && e.name.startsWith("_")) continue;
    const abs = path.join(dir, e.name);
    yield abs;
    yield* walkDirs(abs, options);
  }
}
