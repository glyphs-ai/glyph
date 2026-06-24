import { PORTABLE_ENV_NAME_RE } from "./_constants.js";

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

/**
 * Filter an env bag down to `[key, string-value]` tuples with portable
 * names. Non-string values are silently dropped (they may leak through
 * an upstream `as`-cast over `NodeJS.ProcessEnv`; without this filter,
 * `.replace(...)` would crash on `undefined`).
 *
 * Name validation is intentionally NOT performed here — the single
 * authoritative check lives in `validateLaunchCommand` (called once at
 * entry). This function only filters by type and name shape so that
 * callers never quote a non-portable name or a non-string value.
 *
 * Returns an empty array when `env` is `undefined`.
 */
export function filterStringEntries(
  env: Readonly<Record<string, string>> | undefined,
): [string, string][] {
  if (env === undefined) return [];
  return Object.entries(env).filter(
    (e): e is [string, string] => PORTABLE_ENV_NAME_RE.test(e[0]) && typeof e[1] === "string",
  );
}

/**
 * Returns true when `env` is defined and contains at least one string-valued
 * entry with a portable name. Centralises the "should we inject env?" check
 * used by platform launchers.
 */
export function hasUsableEnv(env: Readonly<Record<string, string>> | undefined): boolean {
  return filterStringEntries(env).length > 0;
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
