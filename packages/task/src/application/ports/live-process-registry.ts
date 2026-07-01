import type { RuntimeExit, RuntimeHandle } from "@glyphs-ai/runtime";

/** Why this manager killed a supervised subprocess (vs it self-exiting). */
export type KillReason = "shutdown" | "cancel";

/** Result of a {@link LiveProcessRegistry.requestKill} attempt. */
export type KillOutcome =
  /** This call owned the kill (the process was live and not already being killed). */
  | "killed"
  /** The process is live but another caller already requested the kill. */
  | "already-killing"
  /** No live process is registered under this id. */
  | "not-live";

/** How a supervised subprocess ended, handed to the `onExit` callback. */
export type ExitOutcome =
  | { readonly kind: "exited"; readonly exit: RuntimeExit }
  | { readonly kind: "watch-failed"; readonly cause: unknown };

/**
 * In-memory index of the subprocesses a task manager is currently
 * supervising. Isolates the {@link RuntimeHandle} mechanics — registration,
 * exit-watching, and kill — behind a port so the application-layer
 * `TaskSupervisor` orchestrates lifecycle without holding OS-process handles
 * itself. It references runtime types, so it is an application-layer port (not
 * a pure-domain contract); its only implementation is pure in-memory
 * coordination (no third-party IO), so that adapter lives beside the supervisor
 * in `supervision/` rather than in `infrastructure/`.
 */
export interface LiveProcessRegistry {
  /**
   * Take ownership of a freshly-spawned handle. `onExit` runs exactly once —
   * when the subprocess exits (or its exit-watch fails) — with the kill reason
   * as observed AT exit time; the registry drops the entry after `onExit`
   * settles. Register-before-await: the entry is queryable immediately, so a
   * concurrent `killAll` sees it.
   */
  supervise(
    id: string,
    handle: RuntimeHandle,
    onExit: (outcome: ExitOutcome, killReason: KillReason | null) => Promise<void>,
  ): void;

  /**
   * Request a best-effort kill of the process under `id`. First-wins: only the
   * first request per process flips the kill reason and sends the signal.
   */
  requestKill(id: string, reason: KillReason): KillOutcome;

  /** Await the `onExit`-settled promise for `id` (resolves immediately if unknown). */
  awaitSettled(id: string): Promise<void>;

  /** Kill every supervised process with `reason` and await all of them to settle. */
  killAll(reason: KillReason): Promise<void>;

  /** Count of currently-supervised processes. */
  size(): number;
}
