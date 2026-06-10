import { homedir } from "node:os";
import path from "node:path";

/** Fallback `~/.glyph` when no `GLYPH_HOME` env var is set. */
export const DEFAULT_GLYPH_HOME = path.join(homedir(), ".glyph");

/**
 * Resolve the glyph home directory from environment. Pure: no fs
 * access. Empty-string overrides (`GLYPH_HOME=""`) are treated as
 * unset.
 *
 * Callers MUST pass `process.env` explicitly. The previous shape
 * defaulted to `{}` which silently returned `DEFAULT_GLYPH_HOME`
 * even when the caller meant "use the running process's env" — a
 * footgun that bit when a refactor accidentally dropped the
 * `process.env` argument and the function became a no-op constant.
 */
export function resolveGlyphHome(env: NodeJS.ProcessEnv): string {
  const homeOverride = env.GLYPH_HOME;
  return path.resolve(homeOverride && homeOverride.length > 0 ? homeOverride : DEFAULT_GLYPH_HOME);
}

/**
 * Filename (under `<home>`) for the CLI lifecycle breadcrumb. Written
 * by `glyph start`, read by `glyph status` / `stop` / `connect`,
 * deleted by `glyph stop`. Records pid + host + port of the running
 * server so a later CLI invocation can find and talk to it.
 */
export const RUNTIME_FILE_NAME = "runtime.json";

/**
 * Persisted shape of `<home>/runtime.json`. Server writes; CLI reads.
 * The breadcrumb is an out-of-band IPC contract — alongside HTTP, this
 * is how the CLI finds a running server.
 */
export interface RuntimeFile {
  /** Schema version — bump on breaking changes. */
  readonly schema: 1;
  /** Pid of the detached server process. */
  readonly pid: number;
  /** Bind host (mirrors `GLYPH_HOST` passed to `start`). */
  readonly host: string;
  /** Listening port (mirrors `PORT` passed to `start`). */
  readonly port: number;
  /** ISO 8601 timestamp captured at `start` time. */
  readonly startedAt: string;
  /** Argv the spawned child saw, captured for diagnostics. */
  readonly serverArgs: readonly string[];
}

/** Resolve `<home>/runtime.json`. */
export function runtimeFilePath(home: string): string {
  return path.join(home, RUNTIME_FILE_NAME);
}

/** Subdirectory (under `<home>`) where the server writes rotated log files. */
export const LOGS_SUBDIR = "logs";

/** Resolve `<home>/logs/`. */
export function logsDir(home: string): string {
  return path.join(home, LOGS_SUBDIR);
}
