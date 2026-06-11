// Public surface for @glyphs-ai/terminal — host a LaunchCommand in a terminal.

export { spawnTerminal } from "./dispatch.js";
export {
  InvalidLaunchCommandError,
  NoTerminalFoundError,
  TerminalSpawnFailedError,
  UnsupportedPlatformError,
} from "./errors.js";
export type {
  LaunchCommand,
  Launcher,
  SpawnTerminalResult,
} from "./types.js";
