/**
 * Public surface of @glyphs-ai/runtime-v2.
 *
 * The Result-based, neverthrow-native runtime contract: the `Runtime`
 * interface, a `RuntimeRegistry` lookup port + in-memory impl, the
 * shared data types, and the discriminated-union error atoms. No
 * concrete CLI adapters live here — they remain in `@glyphs-ai/runtime`
 * until ported; the composition root bridges v1 → v2.
 *
 * Tier role: T0 (foundation / provider). No HTTP, no global state.
 */

export type {
  RuntimeLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
  UnknownRuntime,
} from "./errors.js";
export type { Runtime } from "./runtime.js";
export { InMemoryRuntimeRegistry, type RuntimeRegistry } from "./runtime-registry.js";
export type {
  AgentContentSource,
  BuildInteractiveLaunchOpts,
  LaunchCommand,
  ProvisionOpts,
  ResolvedAgent,
  RuntimeCapabilities,
  RuntimeSessionMetadata,
} from "./types.js";
