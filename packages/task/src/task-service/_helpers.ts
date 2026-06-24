/**
 * Shared utilities for the SPLIT sub-layout of `task-service.ts`.
 * Leading underscore marks this file as a private utility module
 * (NOT a SPLIT peer) per the pkg-template convention. Cross-cutting
 * helpers (`LiveTask`, `safeRm`) live here so the sibling concern
 * modules do not need to reach into each other for shared types or
 * functions.
 *
 * Terminal-transition orchestration (`applyTerminal`, `decideTerminal`,
 * `collectSuccessPayload`) lives in sibling `terminal.ts`.
 *
 * ## `task-service/` SPLIT layout convention
 *
 * **Leaf modules** — `activity-stream.ts`, `agent-resolver.ts`,
 * `dispatch.ts`, `queries.ts`, `shutdown.ts`, and `terminal.ts` —
 * import only from `./_helpers.js` and the parent `../task-service.js`
 * index. They MUST NOT import each other, and they MUST NOT import
 * `./mutations.js`.
 *
 * **Orchestrator exception** — `mutations.ts` is the single
 * exception: it sits at the top of the sub-layout DAG and wires
 * `dispatch.ts` + `agent-resolver.ts` together for the
 * dispatch / cancel / delete lifecycle. As the orchestrator it
 * imports from sibling modules deliberately; nothing reverse-imports
 * `mutations.ts`, so the graph stays acyclic (orchestrator →
 * orchestrated, never the reverse).
 *
 * **Why not route the orchestrator through `_helpers.ts`?** Two
 * unattractive alternatives:
 *
 *   - Re-export the `dispatch` / `agent-resolver` surface from
 *     `_helpers.ts`. Pure indirection with no benefit, and
 *     `_helpers` would no longer be a leaf utility.
 *   - Collapse `mutations.ts` back into a flat module. Defeats the
 *     SPLIT trigger (>= 600 LOC AND >= 3 cohesive concerns) that
 *     justified carving the subdir out in the first place.
 *
 * The orchestrator pattern keeps the DAG acyclic AND the cohesive
 * split intact.
 */

import { rm } from "node:fs/promises";
import type { RuntimeHandle } from "@glyphs-ai/runtime";
import type { Logger } from "pino";

/**
 * In-memory record for a task whose subprocess this manager still
 * owns. Dropped from {@link TaskServiceCtx.live} once the subprocess
 * exits and the post-exit fs writes complete.
 *
 * `killReason` is the mutable flag the exit watcher reads AT exit
 * time to classify terminal status — "why did this manager invoke
 * `handle.kill()`":
 *   - `null`       — subprocess exited on its own
 *   - `'shutdown'` — `TaskService.shutdown()` killed it
 *   - `'cancel'`   — `TaskService.cancel(id)` killed it
 *
 * Concurrent semantics: last-write-wins for `killReason`. `cancel()`
 * and `shutdown()` rarely race (shutdown takes the global flag
 * first); when they do, either terminal kind is semantically correct
 * and the cancel-during-shutdown test accepts either. Concurrent
 * `cancel(id)` calls coordinate via the `wasFirstToCancel` check in
 * `cancelTask`: the first call owns the kill, every subsequent call
 * awaits `live.settled` and then throws `InvalidTransition`.
 */
export interface LiveTask {
  readonly id: string;
  readonly handle: RuntimeHandle;
  /** Resolves once the post-exit persistence has finished. */
  settled: Promise<void>;
  killReason: "shutdown" | "cancel" | null;
}

/** Best-effort recursive remove. Logs (does not throw) on failure. */
export async function safeRm(p: string, logger: Logger): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      {
        path: p,
        err,
      },
      "tasks: failed to remove workdir during cleanup",
    );
  }
}
