import type { ResultAsync } from "neverthrow";
import type { SpawnFailed } from "./errors.js";
import type { LaunchCommand, SpawnResult } from "./types.js";

/**
 * Hosts a {@link LaunchCommand} in a platform terminal emulator.
 * Result-based: a failed launch yields {@link SpawnFailed} instead of
 * throwing, so consumers stay on the Result rail and can fold the
 * failure into a copy-paste fallback. The package's concrete
 * implementation is {@link localSpawner} (`local-spawner.ts`); the
 * composition root injects it into `@glyphs-ai/session`'s
 * `spawnInteractive` use-case, which depends only on this interface.
 */
export interface Spawner {
  spawn(launch: LaunchCommand): ResultAsync<SpawnResult, SpawnFailed>;
}
