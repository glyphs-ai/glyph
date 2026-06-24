import type { WorkflowNodeRetryReason } from "./types.js";

/**
 * Maximum number of consecutive retry-coord insertions per stuck-
 * workflow chain. See {@link WorkflowService.checkStuckAndRecoverInTx}
 * for the rationale; five is the locked operational ceiling.
 */
export const STUCK_RETRY_MAX_ATTEMPTS = 5;

/**
 * Structured `WorkflowFailure` reason persisted on the workflow row
 * when the stuck-coord detector trips the
 * {@link STUCK_RETRY_MAX_ATTEMPTS} cap. The detector transitions the
 * workflow to `failed` with `{ kind: 'substrate', reason:
 * STUCK_RETRY_LIMIT }` in the same tx as the triggering mutation;
 * the dashboard surfaces the reason on the workflow's Overview
 * failure callout.
 *
 * The literal value is mirrored inline on the `WorkflowFailure`
 * substrate arm in `types.ts` (kept as a bare string literal there to
 * avoid a `types.ts -> _stuck-recovery.ts` import edge) and in the
 * `SUBSTRATE_FAILURE_REASONS` guard in `validate.ts`.
 */
export const STUCK_RETRY_LIMIT = "STUCK_RETRY_LIMIT";

/**
 * Internal closure-state type used by the eight mutation primitives
 * to capture the {@link WorkflowService.checkStuckAndRecoverInTx}
 * outcome from inside the tx callback. Hoisted to a named alias so
 * the closure-scoped variable doesn't collapse to `never` under the
 * compiler's flow-narrowing of the discriminated union initializer.
 */
export type StuckRecoveryOutcome =
  | { readonly inserted: false }
  | {
      readonly inserted: true;
      readonly retryNodeId: string;
      readonly reason: WorkflowNodeRetryReason;
      readonly attempt: number;
    };
