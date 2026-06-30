import type { ResultAsync } from "neverthrow";
import type {
  RuntimeLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
} from "./errors.js";
import type {
  BuildInteractiveLaunchOpts,
  LaunchCommand,
  ProvisionOpts,
  RuntimeCapabilities,
  RuntimeSessionMetadata,
} from "./types.js";

/**
 * A Runtime adapts a third-party CLI (Copilot, Gemini, Claude Code, …)
 * for use by glyph. Result-based: every behavioural method returns a
 * `ResultAsync` with a discriminated-union error — no throws cross this
 * boundary. Runtimes are stateless across calls; per-conversation data
 * is keyed by an opaque `runtimeSessionId`.
 *
 * This is the v2 (neverthrow-native) contract. While the concrete
 * adapters still live in `@glyphs-ai/runtime` (throw-based), the
 * composition root bridges a v1 runtime into this shape; once an
 * adapter implements v2 natively, the bridge is dropped.
 *
 * Scope note: this surface currently covers the interactive-session
 * lifecycle (the first consumer, `@glyphs-ai/session`). Headless
 * execution and the activity/observability surface are added when the
 * task / server consumers migrate.
 */
export interface Runtime {
  /** Stable lookup key for this runtime (e.g. `"copilot"`). */
  readonly kind: string;

  /** Optional advertised capability flags. */
  readonly capabilities?: RuntimeCapabilities;

  /**
   * Bake `opts.agent` into `opts.workdir`. Returns the opaque
   * `runtimeSessionId` binding this conversation to the CLI's session
   * (`null` for discovery-only runtimes that mint the id at first
   * launch). `opts.workdir` is guaranteed to exist and be empty.
   */
  provision(
    opts: ProvisionOpts,
  ): ResultAsync<{ runtimeSessionId: string | null }, RuntimeProvisionFailed>;

  /**
   * Build the shell incantation that drops the user into an interactive
   * CLI session. A non-null `runtimeSessionId` requests a resume.
   */
  buildInteractiveLaunch(
    runtimeSessionId: string | null,
    opts: BuildInteractiveLaunchOpts,
  ): ResultAsync<LaunchCommand, RuntimeLaunchFailed>;

  /**
   * Read runtime-managed display metadata (title / lastActiveAt) for one
   * `runtimeSessionId`. Best-effort: resolves to `null` when the runtime
   * has no record or any read fault occurs — it never fails the Result.
   */
  readMetadata(runtimeSessionId: string): ResultAsync<RuntimeSessionMetadata | null, never>;

  /**
   * Remove the runtime's recorded state for one `runtimeSessionId`.
   * No-op when no state exists.
   */
  deleteState(runtimeSessionId: string): ResultAsync<void, RuntimeStateDeletionFailed>;
}
