/**
 * Public surface of @glyphs-ai/terminal.
 *
 * The Result-based, neverthrow-native terminal: the `Spawner` interface,
 * its `LaunchCommand` input + `SpawnResult` output, the `SpawnFailed`
 * discriminated-union error atom, and `localSpawner` — the concrete
 * `node:child_process` implementation (the composition root injects it
 * into `@glyphs-ai/session`). The cross-platform launcher + its quoting
 * dialects stay package-private; throws are caught at the `Spawner`
 * boundary and surfaced as `SpawnFailed`.
 *
 * Tier role: T0 (foundation / provider). No HTTP, no global state.
 */

export type { SpawnFailed } from "./errors.js";
export { localSpawner } from "./local-spawner.js";
export type { Spawner } from "./spawner.js";
export type { LaunchCommand, SpawnResult } from "./types.js";
