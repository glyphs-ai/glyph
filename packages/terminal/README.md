# @glyphs-ai/terminal

> **Tier:** T0 (Foundations / provider). See the [tier model](../../docs/architecture.md#tier-model).

Hosts a shell-runnable `LaunchCommand` inside a per-platform terminal
emulator. Glyph uses this for one-click interactive launch: instead of
asking the user to copy a manual `cd … && <runtime-cli> …` command into
their shell, the server opens the user's terminal in the requested
workdir with the command already running.

Result-based: `localSpawner.spawn(launch)` returns a
`ResultAsync<SpawnResult, SpawnFailed>` — a failed launch (no emulator
found, an unsupported platform, a fast child crash, an invalid command)
is surfaced as a `SpawnFailed` atom, never thrown across the package
boundary.

## Consumer port

`LaunchCommand` is defined in this package and matched structurally
against whatever the producer hands to `localSpawner.spawn`. The current
producer is `@glyphs-ai/runtime-v2`'s `Runtime.buildInteractiveLaunch`,
but any structurally compatible object works. The wiring relies on
TypeScript's structural typing at the call site rather than a workspace
dependency on a specific producer package. Keeping the type local makes
terminal a pure infrastructure leaf consumable by any caller that can
produce a command of this shape.

```ts
interface LaunchCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly display: string;
  readonly env?: Readonly<Record<string, string>>;
}
```

`@glyphs-ai/session`'s `spawnInteractive` use-case consumes the
structurally-typed `Spawner` port; the composition root (`@glyphs-ai/api`)
injects `localSpawner`. `session` deliberately does not value-import this
package — `LaunchCommand` is the structural seam, so the architecture
fence stays intact.

## Supported launchers

| Platform | Preferred                                    | Fallback                |
| -------- | -------------------------------------------- | ----------------------- |
| Windows  | `wt.exe` hosted in `pwsh` / `powershell`     | `cmd.exe /k`            |
| macOS    | `Terminal.app` via `osascript "do script …"` | —                       |
| Linux    | `gnome-terminal`, `kgx`, `konsole`, `xfce4-terminal`, `mate-terminal`, `tilix`, `wezterm`, `alacritty`, `kitty`, `lxterminal`, `xterm` | `x-terminal-emulator` |

The Linux candidates are tried in the order listed above; the first
one found on `PATH` wins. `x-terminal-emulator` is intentionally last
because on Debian/Ubuntu it points to whatever the user picked and has
no portable arg convention.

> Env propagation mechanism differs per launcher — see § Env-propagation
> guarantees below.

## Env-propagation guarantees

When `LaunchCommand.env` is non-empty, the package guarantees the variables
reach the spawned command's `process.env` — but the mechanism differs
per platform because most terminal apps run as long-lived daemons that
ignore env handed to their launcher process:

- **macOS (`Terminal.app`)** — env is inlined as `export K='v' && ` in
  the shell line passed to `osascript "do script …"`. Terminal.app's
  daemon ignores the environment passed to `osascript`; the inline
  prefix runs in the child shell that executes the command.
- **Linux (every emulator)** — when env is set, all candidates are
  routed through `sh -lc "<export … && cd … && exec …>"`. The native
  argv forms (`gnome-terminal -- argv`, etc.) cannot carry env because
  the emulator daemon inherits env from its first invocation, not from
  subsequent client launches.
- **Windows (`wt.exe` + pwsh)** — env is inlined as
  `$env:K = 'v'; …; & 'cmd' 'args'` inside the `pwsh -Command` payload.
  `wt.exe` runs as a daemon, so spawn-time env doesn't reach new tabs,
  but the pwsh we host inside the new tab is in our control.
  Semicolons in the payload are escaped as `\;` because `wt.exe`
  treats `;` as a command separator across the whole command line.
- **Windows (`cmd.exe` fallback)** — env is propagated via the spawn
  `env` option. `cmd /k` reliably inherits env from its parent, so no
  inline `set` prefix is needed.

Environment names must be portable shell identifiers
(`[A-Za-z_][A-Za-z0-9_]*`). Among valid names, keys are preserved in
insertion order, and only string-valued entries survive. `undefined`,
`null`, and other non-string values are dropped defensively before
quoting.

## API

The example below shows a command produced by the Copilot runtime; other
runtimes can provide their own `cmd` and `args`.

```ts
import { localSpawner, type LaunchCommand } from "@glyphs-ai/terminal";

const cmd: LaunchCommand = {
  cmd: "copilot",
  args: ["--session-id=…"],
  cwd: "/path/to/workspace",
  display: "cd '/path/to/workspace' && copilot --session-id=…",
  env: { GLYPH_WORKSPACE: "ws-uuid" },
};

const result = await localSpawner.spawn(cmd);
result.match(
  ({ launcher }) => {
    // opened in `launcher`: "wt" | "cmd" | "Terminal" | "gnome-terminal" | …
  },
  (err) => {
    // err.code / err.message — fall back to copy-pasting `cmd.display`
  },
);
```

A failed launch is surfaced as a single `SpawnFailed` atom
(`{ type: "SpawnFailed"; code; message }`), never thrown across the
boundary. `code` is the internal error class's name —
`NoTerminalFoundError`, `TerminalSpawnFailedError`,
`UnsupportedPlatformError`, `InvalidLaunchCommandError`, or `SpawnError`
for a raw child-process fault — giving the wire layer a stable machine
label; `message` is human-readable detail. The throwing classes
themselves are package-private (caught at the `Spawner` boundary).

## Surface

```
packages/terminal/src/
  spawner.ts        Spawner interface (Result-based)
  local-spawner.ts  localSpawner + the platform dispatch it wraps
  types.ts          public DTOs: LaunchCommand, SpawnResult
  errors.ts         SpawnFailed discriminated-union atom
  _errors.ts        internal throw classes caught at the boundary
  _quoting.ts       per-platform quoting dialects (package-private)
  _spawn.ts         node:child_process + fs adapters (package-private)
  _validate.ts      LaunchCommand validation (package-private)
  platforms/        wt/cmd, Terminal.app, gnome-terminal launchers
```

## Testing

```sh
pnpm --filter @glyphs-ai/terminal typecheck
pnpm --filter @glyphs-ai/terminal test
```

## License

MIT
