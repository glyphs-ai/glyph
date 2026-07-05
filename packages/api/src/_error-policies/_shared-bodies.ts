/**
 * Shared body builders for `_error-policies/*` entries — stable
 * response shapes that multiple policies need to return verbatim.
 *
 * Kept here, in the consumer directory, rather than inlined into
 * `_respond-error.ts` (the matcher engine) so the catalog of body
 * builders can grow without bloating the matcher. The underscore
 * prefix signals "internal to this directory"; there is no barrel
 * under `_error-policies/`, so importers reach in via explicit
 * filename.
 */

/**
 * Opaque 500 body for operator-configuration faults (e.g. schedule-kind
 * registry mistakes) whose `.message` may name internal wiring the wire
 * shouldn't leak. Collapses the message to `"internal error"` but keeps the
 * error class `name` as `code` so a dashboard can still branch on the
 * specific fault without depending on the message. The real diagnostics land
 * in the server log via `logFault()`.
 */
export const opaqueInternalErrorBody = (err: Error) => ({
  error: "internal error",
  code: err.name,
});

/**
 * `WorkflowWorkerNotInCoordMenuError` is caller-fixable (its 400 status
 * says "pick an agent that's in the menu"), but its `.message`
 * enumerates the coordinator's full `dependencies.agents` dispatch menu
 * — internal workflow topology that stays off the wire. The body is
 * collapsed to `{ error: "internal error", code:
 * "WorkflowWorkerNotInCoordMenuError" }` so the dashboard can still
 * branch on the code without the menu leaking. The `_err` parameter
 * is unused because the envelope is stable.
 */
export const opaqueWorkerNotInCoordMenuBody = (_err: Error) => ({
  error: "internal error",
  code: "WorkflowWorkerNotInCoordMenuError",
});
