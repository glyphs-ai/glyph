/**
 * Shared helpers used by the platform-specific terminal spawners.
 *
 * This module packs several distinct functional groups into one file
 * because each group is small (< 50 LOC) and they all serve the same
 * consumer — the per-platform `spawn{Windows,MacOS,Linux}` functions.
 * The section separators below delineate the groups for scan-ability:
 *
 *   1. Input validation — reject dangerous characters before quoting
 *   2. Observation — detect early spawn failures via a timeout race
 *   3. Shell quoting — per-shell string escape (POSIX, cmd.exe, pwsh)
 *   4. Env-prefix builders — inline `export`/`$env:` prefixes for
 *      daemon-mode terminal emulators that ignore spawn-time env
 *   5. Spawn infrastructure — real `child_process.spawn` wrapper +
 *      filesystem helpers (robust existence check, PATH lookup)
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { InvalidLaunchCommandError } from "./errors.js";
import type { LaunchCommand, SpawnHandle, SpawnOpts } from "./types.js";

// ─── Input validation ───────────────────────────────────────────────

/** Reject command fields with control characters that could break shell/AppleScript quoting. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control chars is the explicit purpose.
const CONTROL_CHARS_RE = /[\x00-\x1f]/;
const PORTABLE_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateLaunchCommand(cmd: LaunchCommand): void {
  if (CONTROL_CHARS_RE.test(cmd.cwd)) {
    throw new InvalidLaunchCommandError("workdir contains a control character");
  }
  if (CONTROL_CHARS_RE.test(cmd.cmd)) {
    throw new InvalidLaunchCommandError("command contains a control character");
  }
  for (const a of cmd.args) {
    if (CONTROL_CHARS_RE.test(a)) {
      throw new InvalidLaunchCommandError("argument contains a control character");
    }
  }
  for (const name of Object.keys(cmd.env ?? {})) {
    assertPortableEnvName(name);
  }
}

// ─── Observation ────────────────────────────────────────────────────

/**
 * Race the spawn handle's earlyFailure signal against an observation timer.
 * Returns the failure if the child died fast, or null if it stayed alive
 * past `observationMs` (which we treat as success — the launcher kept
 * running long enough to be considered launched).
 */
export async function waitForEarlyFailure(
  handle: SpawnHandle,
  observationMs: number,
): Promise<{ reason: string } | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), observationMs);
  });
  try {
    return await Promise.race([handle.earlyFailure, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// ─── Shell quoting ──────────────────────────────────────────────────

/** POSIX-portable single-quote escape for shell argv. Used by macOS + Linux. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * `cmd.exe` shell metacharacters that must not be allowed to reach cmd.exe's
 * shell parser unescaped. `%` and `!` (with delayed expansion) trigger
 * variable substitution even inside double-quoted strings; the rest break
 * out of the intended argument when a value is unquoted on the cmd.exe
 * command line. `"` is included because we wrap each token in `"…"` and
 * an embedded `"` would prematurely close the quoted region.
 */
const CMD_META_RE = /["%&|<>^!()]/g;

/**
 * Escape an argument that will be passed inside a `cmd.exe /c …` command
 * line built with `windowsVerbatimArguments: true`.
 *
 * Strategy: wrap the value in double quotes (so spaces, `&`, `|`, `<`, `>`,
 * `^`, `(`, `)` lose their shell meaning) and prefix every metacharacter —
 * including the few that remain dangerous inside double quotes (`%`, `!`) —
 * with `^`. Embedded `"` becomes `^"` so it survives cmd.exe's parser as a
 * literal quote rather than terminating the quoted region.
 *
 * This must be paired with `windowsVerbatimArguments: true` on the spawn
 * call: that flag tells libuv to skip its own MSVCRT-style escaping, which
 * would otherwise mangle the carets/quotes we just added.
 */
export function escapeCmdArg(s: string): string {
  return `"${s.replace(CMD_META_RE, "^$&")}"`;
}

/**
 * PowerShell single-quoted-string escape. PowerShell's `'…'` literals have
 * exactly one escape rule: `''` is a literal `'`. No backslash, no `$`/`"`
 * interpolation, no command substitution. Anything else is taken verbatim.
 *
 * Used to assemble a pwsh `-Command "& 'foo' 'arg1' …"` payload where the
 * call operator (`&`) invokes a program by name with each subsequent
 * single-quoted token as a literal argv entry. This is the safe pwsh
 * equivalent of POSIX `'foo'` quoting.
 */
export function pwshQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// ─── Env-prefix builders ────────────────────────────────────────────

/**
 * Filter an env bag down to `[key, string-value]` tuples after checking
 * that names are portable shell identifiers. Non-string values may have
 * leaked past the typed contract (`Readonly<Record<string, string>>`)
 * via an upstream `as`-cast over `NodeJS.ProcessEnv`; without this
 * filter, a leaked `undefined` would crash `shQuote(v)` /
 * `pwshQuote(v)` at `undefined.replace`.
 *
 * Returns an empty array when `env` is `undefined`, so callers can
 * unconditionally call `filterStringEntries(env)` and then branch on
 * `entries.length === 0` for the empty-prefix shortcut.
 */
function filterStringEntries(
  env: Readonly<Record<string, string>> | undefined,
): [string, string][] {
  if (env === undefined) return [];
  return Object.entries(env).filter((e): e is [string, string] => {
    assertPortableEnvName(e[0]);
    return typeof e[1] === "string";
  });
}

function assertPortableEnvName(name: string): void {
  if (!PORTABLE_ENV_NAME_RE.test(name)) {
    throw new InvalidLaunchCommandError(
      `environment variable name ${JSON.stringify(name)} is not portable`,
    );
  }
}

/**
 * POSIX shell `export K='v' M='v' && ` prefix, suitable for prepending to a
 * `sh -c` line that should run with these environment variables set.
 * Returns an empty string when `env` is empty or undefined so callers
 * can unconditionally concatenate without branching.
 *
 * Why inlined into the shell line and not passed as spawn `env`: the
 * terminal apps we target on macOS (Terminal.app) and Linux
 * (gnome-terminal in daemon mode) ignore the env we hand to their
 * launcher process — they spawn the user's shell from a long-lived
 * daemon process whose env was set at daemon startup. The shell that
 * executes the command, however, is under our control via the shell
 * line we construct, so `export ... &&` reliably reaches it.
 *
 * Keys are emitted in insertion order for deterministic test output.
 * Values are POSIX-quoted via `shQuote`; embedded quotes / specials
 * are safe.
 */
export function shExportPrefix(env: Readonly<Record<string, string>> | undefined): string {
  const entries = filterStringEntries(env);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}=${shQuote(v)}`);
  return `export ${parts.join(" ")} && `;
}

/**
 * PowerShell `$env:K = 'v'; $env:M = 'v'; ` prefix, suitable for prepending
 * to a `pwsh -Command "..."` payload before the call operator (`&`) that
 * invokes the program. Returns an empty string when `env` is empty or
 * undefined.
 *
 * Why inlined into the pwsh -Command payload and not passed as spawn `env`:
 * Windows Terminal (`wt.exe`) is a service-like daemon — when it's already
 * running, new tabs are owned by the existing wt process and our
 * spawn-time env doesn't reach them. The pwsh that we explicitly host
 * inside the new tab is under our control via the -Command payload, so
 * `$env:K = 'v'; ` reliably runs before `& '<cmd>' '<args>'`.
 *
 * Keys are emitted in insertion order. Values are pwsh-quoted via
 * `pwshQuote`; embedded `'` becomes `''` per pwsh single-quote rules.
 */
export function pwshEnvPrefix(env: Readonly<Record<string, string>> | undefined): string {
  const entries = filterStringEntries(env);
  if (entries.length === 0) return "";
  return `${entries.map(([k, v]) => `$env:${k} = ${pwshQuote(v)}`).join("; ")}; `;
}

// ─── Spawn infrastructure ───────────────────────────────────────────

/**
 * Default dependencies backed by node:child_process and node:fs. The returned
 * SpawnHandle.earlyFailure resolves to a non-null reason if the child emits
 * `error` (e.g. ENOENT) or exits with a non-zero code; otherwise it stays
 * pending forever and the observation timer wins.
 */
export function realSpawn(file: string, args: readonly string[], opts: SpawnOpts): SpawnHandle {
  let child: ChildProcess;
  try {
    child = nodeSpawn(file, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: opts.windowsVerbatimArguments,
      // Omit the spawn `env` key entirely when the caller passes
      // `opts.env === undefined`, so the child inherits the parent's
      // `process.env` (Node's default behaviour). The wt-branch path
      // leaves `env` undefined; env propagation there happens by inlining `$env:`
      // assignments into the pwsh -Command payload (see
      // `platforms/windows.ts:buildWtArgs`). The cmd /k fallback sets
      // `opts.env` explicitly when `cmd.env` is non-empty, because
      // `cmd /k` reliably inherits from its parent process and no
      // inline `set …` prefix is needed.
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { earlyFailure: Promise.resolve({ reason }) };
  }
  const earlyFailure: Promise<{ reason: string } | null> = new Promise((resolve) => {
    child.once("error", (err) => {
      resolve({ reason: err instanceof Error ? err.message : String(err) });
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        resolve({ reason: `process exited with code ${code}` });
      }
      // exit 0 in observation window means the launcher itself returned
      // (e.g. wt.exe forks and exits, which is fine). Don't treat as failure.
    });
  });
  if (typeof child.unref === "function") child.unref();
  return { earlyFailure };
}

/**
 * Robust file-presence check that handles Windows App Execution Aliases.
 *
 * `wt.exe` (and other `WindowsApps\*.exe` entries) are 0-byte files with the
 * `IO_REPARSE_TAG_APPEXECLINK` reparse tag — the kernel intercepts CreateProcess
 * to launch the real binary, but plain `stat()` fails because there is no real
 * file behind the reparse point. `fs.existsSync` follows the reparse point and
 * reports `false` for these aliases, which would make us skip wt entirely and
 * fall through to cmd even when Windows Terminal is installed.
 *
 * `lstatSync` returns the reparse point's own metadata without following, so
 * it correctly reports "exists" for App Execution Aliases.
 */
export function existsLike(p: string): boolean {
  try {
    return lstatSync(p, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return existsSync(p);
  }
}

/**
 * Best-effort PATH lookup using existsSync over PATH directories.
 *
 * Uses `existsSync` (not `existsLike`) deliberately: PATH-discovered
 * binaries are invoked by name (not by full path), so the shell/OS
 * resolves App Execution Aliases at exec time regardless of what our
 * probe returns. The full-path `existsLike` probe is only needed for
 * the `wt.exe` LOCALAPPDATA check in `spawnWindows`, where we pass
 * the resolved path directly to `deps.spawn`.
 */
export function whichSyncDefault(name: string): string | null {
  const PATH = process.env.PATH ?? "";
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, ext ? name + ext.toLowerCase() : name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
