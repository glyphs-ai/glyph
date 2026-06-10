/**
 * Cross-platform helper that opens a new terminal window in the requested
 * working directory and runs a launch command there. The dashboard uses it
 * for one-click interactive launch: instead of asking the user to copy a
 * `cd ... && <runtime-cli>` command, the server opens the user's terminal
 * with the command already running.
 *
 * Designed to be testable: the real `spawnTerminal` is a thin wrapper around
 * `spawnTerminalWith(cmd, deps)`, where the dependencies abstract platform
 * detection and spawn so unit tests can drive every code path without
 * touching the host.
 */

/**
 * Shell-runnable launch command, as the terminal package needs it.
 *
 * **Consumer port.** Terminal defines the shape it needs to spawn a
 * process into a platform terminal emulator. Producers — currently
 * `@glyphs-ai/runtime`'s `Runtime.buildInteractiveLaunch` — own their
 * own definition; the wiring relies on TypeScript's structural
 * typing to confirm compatibility at the call sites. Keeping this
 * type local removes terminal's workspace dependency on any specific
 * producer package and makes terminal a pure infrastructure leaf
 * consumable by anything that can produce a command of this shape.
 *
 * The primary consumer is
 * `SessionService.spawnInteractive` (in `@glyphs-ai/session`), which
 * receives `spawnTerminal` via a `SpawnFn` port injected by
 * `@glyphs-ai/api`'s `composeApplication`. `@glyphs-ai/session` deliberately
 * does not import `@glyphs-ai/terminal` at all (neither as a value nor
 * as a type); `SpawnFn`'s structural shape
 * (`(cmd: LaunchCommand) => Promise<{ launcher: string }>`) is what
 * holds the two together, with `spawnTerminal`'s return type
 * (`SpawnTerminalResult = { launcher: Launcher }`) satisfying it
 * via covariance (`Launcher` is a `string` subtype). The "consumable
 * by anything" framing is therefore accurate rather than aspirational.
 *
 * The `cmd`/`args`/`cwd` triple is suitable for `child_process.spawn`;
 * `display` is a single-line string suitable for showing to the user
 * or copying to the clipboard.
 */
export interface LaunchCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly display: string;
  /**
   * Optional environment variables for the spawned terminal session.
   *
   * Most platform terminal emulators (Windows Terminal, Terminal.app,
   * gnome-terminal, …) run as long-lived daemons that do not see the
   * env handed to the launcher process. Reliably propagating env to
   * the shell that executes this command therefore requires inlining
   * the env into the shell command itself (`export K='v' &&
   * exec foo args` on POSIX, `$env:K='v'; & foo args` for pwsh).
   * This package does that work; see the per-platform implementations
   * in `src/platforms/`.
   *
   * The terminal filter is value-based, not name-based: keys are
   * preserved in insertion order, and only string-valued entries survive.
   * Producers should filter `undefined` / `null` before assembling this
   * map; terminal also drops non-string entries defensively before
   * quoting so a bad cast over `NodeJS.ProcessEnv` cannot crash the
   * launch path.
   */
  readonly env?: Readonly<Record<string, string>>;
}

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
   * Used as a belt-and-suspenders for the Windows `cmd /k` fallback,
   * where the new console naturally inherits parent env. The wt+pwsh
   * and macOS/Linux paths inline env into the shell command instead
   * (because their target apps run as daemons and ignore spawn env);
   * see the per-platform implementations.
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
