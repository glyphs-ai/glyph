/**
 * Data types for the terminal contract: the launch command a
 * {@link Spawner} consumes and the result it yields. `LaunchCommand` is
 * intentionally identical in shape to `@glyphs-ai/runtime`'s, so a
 * runtime's built launch satisfies `Spawner.spawn` by structural typing
 * — terminal never imports from runtime (a terminal must not
 * depend on a runtime).
 */

/** A shell-runnable launch command handed to {@link Spawner.spawn}. */
export interface LaunchCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly display: string;
  /** Optional env vars the spawned terminal session should inherit. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Outcome of a successful {@link Spawner.spawn}. */
export interface SpawnResult {
  /** Identifier of the terminal emulator that was launched. */
  readonly launcher: string;
}

// ─── internal implementation types (not part of the public contract) ───
// Consumed by the package-private platform launchers + dispatch; never
// re-exported from `index.ts`.

/** Concrete terminal-emulator launchers the platform code may pick. */
export type Launcher =
  | "wt"
  | "cmd"
  | "Terminal"
  | "gnome-terminal"
  | "kgx"
  | "konsole"
  | "xfce4-terminal"
  | "mate-terminal"
  | "tilix"
  | "wezterm"
  | "alacritty"
  | "kitty"
  | "lxterminal"
  | "xterm"
  | "x-terminal-emulator";

/** Internal launch outcome carrying the concrete {@link Launcher}. */
export interface SpawnTerminalResult {
  launcher: Launcher;
}

export interface SpawnHandle {
  /**
   * Resolves to `{ reason }` if the child emits `error` (e.g. ENOENT)
   * or exits with a non-zero code before the caller's observation
   * window elapses. In the happy path the promise stays pending —
   * the caller is expected to race it against an observation timer
   * (see `waitForEarlyFailure`). The `null` arm of the union exists
   * so that the post-race result can share this type; no producer in
   * this package resolves the promise with `null` directly.
   */
  earlyFailure: Promise<{ reason: string } | null>;
}

export interface SpawnOpts {
  cwd?: string;
  /**
   * Windows-only: when true, libuv passes `args` to CreateProcessW with no
   * MSVCRT-style escaping/quoting — args are joined verbatim with single
   * spaces. Used by the cmd.exe fallback so that we control cmd.exe's shell
   * parsing entirely (preventing shell-metachar injection in cwd/args).
   */
  windowsVerbatimArguments?: boolean;
  /**
   * Optional env override. When undefined, the child inherits the
   * parent's `process.env` (Node default). When set, `realSpawn`
   * passes it as-is to `child_process.spawn`'s `env` option — the
   * caller is responsible for merging with `process.env` if they
   * want partial-override semantics.
   *
   * Used by the Windows `cmd /k` fallback, where the new console
   * naturally inherits parent env. The wt+pwsh and macOS/Linux paths
   * inline env into the shell command instead (because their target
   * apps run as daemons and ignore spawn env); see the per-platform
   * implementations.
   */
  env?: NodeJS.ProcessEnv;
}

export interface SpawnTerminalDeps {
  spawn: (file: string, args: readonly string[], opts: SpawnOpts) => SpawnHandle;
  exists: (p: string) => boolean;
  whichSync: (name: string) => string | null;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Time to wait after spawning to surface immediate failures (ms). */
  observationMs: number;
}
