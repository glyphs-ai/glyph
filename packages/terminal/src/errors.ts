/**
 * Error atoms — discriminated-union values flowing through `Result`, not
 * thrown exceptions. Returned by {@link Spawner.spawn} when a terminal
 * launch fails.
 */

/**
 * The terminal could not be launched. `code` is a stable machine label
 * — the underlying error's class name (e.g. `NoTerminalFoundError`,
 * `TerminalSpawnFailedError`, `UnsupportedPlatformError`); `message` is
 * human-readable detail for the copy-paste fallback.
 */
export type SpawnFailed = {
  readonly type: "SpawnFailed";
  readonly message: string;
  readonly code: string;
};
