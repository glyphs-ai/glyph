/**
 * Terminal dispatch — platform-routing entry point for `spawnTerminal`.
 *
 * Two entry points serve the same logic with different dependency wiring:
 *
 *   - {@link spawnTerminalWith}: dependency-injected. Tests call this directly
 *     to drive any platform branch with fake spawn/fs/PATH dependencies,
 *     avoiding host-specific side effects entirely.
 *
 *   - {@link spawnTerminal}: production wrapper. Fills in the real
 *     `node:child_process` spawn, `node:fs` existence checks, and
 *     `process.platform` so callers get a zero-config one-shot function.
 *
 * Platform routing is a simple switch on `deps.platform`:
 *   `win32` → Windows Terminal or cmd.exe fallback
 *   `darwin` → Terminal.app via osascript
 *   `linux` → first available emulator from a priority list
 *
 * Validation (control-char rejection, env-name portability) runs before
 * dispatch so every platform receives a pre-validated `LaunchCommand`.
 */

import { existsLike, realSpawn, validateLaunchCommand, whichSyncDefault } from "./_shared.js";
import { UnsupportedPlatformError } from "./errors.js";
import { spawnLinux } from "./platforms/linux.js";
import { spawnMacOS } from "./platforms/macos.js";
import { spawnWindows } from "./platforms/windows.js";
import type { LaunchCommand, SpawnTerminalDeps, SpawnTerminalResult } from "./types.js";

/**
 * Dependency-injected dispatch entry. Used directly by tests to drive any
 * platform branch without touching the host. Production code calls
 * `spawnTerminal` instead, which fills in the real `node:child_process`
 * and `node:fs` dependencies.
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

/** Production entry point — spawns a terminal for the given launch command. */
export function spawnTerminal(cmd: LaunchCommand): Promise<SpawnTerminalResult> {
  return spawnTerminalWith(cmd, DEFAULT_DEPS);
}
