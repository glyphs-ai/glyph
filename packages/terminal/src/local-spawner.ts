import { ResultAsync } from "neverthrow";
import { UnsupportedPlatformError } from "./_errors.js";
import { existsLike, realSpawn, validateLaunchCommand, whichSyncDefault } from "./_shared.js";
import type { SpawnFailed } from "./errors.js";
import { spawnLinux } from "./platforms/linux.js";
import { spawnMacOS } from "./platforms/macos.js";
import { spawnWindows } from "./platforms/windows.js";
import type { Spawner } from "./spawner.js";
import type {
  LaunchCommand,
  SpawnResult,
  SpawnTerminalDeps,
  SpawnTerminalResult,
} from "./types.js";

/**
 * Dependency-injected platform dispatch: validate the command, then
 * route to the per-platform launcher. Throws on failure
 * (`InvalidLaunchCommandError`, `UnsupportedPlatformError`, or a
 * launcher's `NoTerminalFoundError` / `TerminalSpawnFailedError`); the
 * {@link Spawner} boundary below catches these. Exported for the
 * platform + dispatch tests, which drive each branch through an injected
 * `deps` and assert the exact spawn argv without touching the host.
 */
export async function spawnTerminalWith(
  cmd: LaunchCommand,
  deps: SpawnTerminalDeps,
): Promise<SpawnTerminalResult> {
  validateLaunchCommand(cmd);
  switch (deps.platform) {
    case "win32":
      return await spawnWindows(cmd, deps);
    case "darwin":
      return await spawnMacOS(cmd, deps);
    case "linux":
      return await spawnLinux(cmd, deps);
    default:
      throw new UnsupportedPlatformError(deps.platform);
  }
}

const DEFAULT_DEPS: SpawnTerminalDeps = {
  spawn: realSpawn,
  exists: existsLike,
  whichSync: whichSyncDefault,
  platform: process.platform,
  env: process.env,
  observationMs: 350,
};

/**
 * Map an internal throw — `NoTerminalFoundError`,
 * `TerminalSpawnFailedError`, `UnsupportedPlatformError`,
 * `InvalidLaunchCommandError`, or a raw `node:child_process` fault — into
 * the public {@link SpawnFailed} atom. `code` is the error's class name
 * so the wire layer can key off a stable machine label; `message` is
 * human-readable detail for the copy-paste fallback.
 */
function toSpawnFailed(cause: unknown): SpawnFailed {
  return {
    type: "SpawnFailed",
    message: cause instanceof Error ? cause.message : String(cause),
    code: cause instanceof Error && cause.name ? cause.name : "SpawnError",
  };
}

const toResult = (r: SpawnTerminalResult): SpawnResult => ({ launcher: r.launcher });

/**
 * Build a {@link Spawner} over an injected {@link SpawnTerminalDeps}. The
 * test seam: lets specs drive any platform branch (and its failure
 * modes) without touching the host, then assert the resulting Result.
 */
export function spawnerWith(deps: SpawnTerminalDeps): Spawner {
  return {
    spawn: (launch) =>
      ResultAsync.fromPromise(spawnTerminalWith(launch, deps), toSpawnFailed).map(toResult),
  };
}

/**
 * Production {@link Spawner}: opens the user's terminal emulator via
 * `node:child_process`, catching every throw at this boundary and
 * returning a {@link SpawnFailed} instead. This is terminal's only
 * concrete implementation; the composition root injects it into
 * `@glyphs-ai/session`.
 */
export const localSpawner: Spawner = {
  spawn: (launch) =>
    ResultAsync.fromPromise(spawnTerminalWith(launch, DEFAULT_DEPS), toSpawnFailed).map(toResult),
};
