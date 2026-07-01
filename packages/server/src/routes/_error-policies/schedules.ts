/**
 * Per-domain error policy for the schedules routes.
 *
 * `statuses` are the (class, status) pairs for schedule CRUD, manual run,
 * and preview. `codeStatuses` covers the task-dispatch fallthrough.
 *
 * ## Task-dispatch fallthrough
 *
 * The schedule pkg is kind-agnostic — it does not know what an "agent" is
 * and throws no agent-related errors. The task-kind handler in
 * `packages/api/src/wiring/schedule-task-handler.ts` performs the catalog
 * existence lookup during `validate(data)` and invokes the task kind
 * handler's `dispatchTask.execute` on `POST /:sid/run`; a missing agent,
 * a resolver crash, or any task dispatch failure surfaces as a
 * `TaskOperationError` carrying the union `type` as `.code`. The shared
 * `taskUnionCodeStatuses` table resolves those codes to the same status
 * + body as the task routes, so callers don't read two policy files to
 * predict status.
 */

import {
  TaskScheduleTargetError,
  taskUnionCodeStatuses,
  WorkflowScheduleTargetError,
} from "@glyphs-ai/api";
import {
  InvalidCronExprError,
  InvalidJsonPathError,
  InvalidScheduleIdError,
  InvalidTimezoneError,
  ScheduleEnabledError,
  ScheduleError,
  ScheduleHasInFlightError,
  ScheduleKindAlreadyRegisteredError,
  ScheduleKindMismatchError,
  ScheduleKindNotRegisteredError,
  ScheduleKindRegistryFrozenError,
  ScheduleNotFoundError,
} from "@glyphs-ai/schedule";
import type { ErrorPolicy } from "../_respond-error.js";
import { opaqueInternalErrorBody } from "./_shared-bodies.js";

export const schedulesErrorPolicy: ErrorPolicy = {
  name: "schedules",
  statuses: [
    [InvalidScheduleIdError, 400],
    [InvalidCronExprError, 400],
    [InvalidTimezoneError, 400],
    [InvalidJsonPathError, 400],
    // Task-kind-handler-side input validation (the handler's
    // `validate` rejects malformed task target data — wire-side
    // duplicate of `validateTaskTargetData` for defense-in-depth).
    // Lives in `@glyphs-ai/api` because the kind handler is wired
    // there; reaches the policy via api's public surface.
    [TaskScheduleTargetError, 400],
    // Workflow-kind-handler-side input validation (mirrors task
    // handler pattern for the workflow target shape).
    [WorkflowScheduleTargetError, 400],
    [ScheduleNotFoundError, 404],
    [ScheduleKindMismatchError, 404],
    [ScheduleEnabledError, 409],
    [ScheduleHasInFlightError, 409],
    // Operator-config bugs (the wiring layer forgot a registerKind
    // call, or registered twice, or ran recover() too early). These
    // are 500s with opaque bodies — they should never reach a
    // production wire surface in a healthy deploy, but if they do
    // the response shouldn't leak the kind name.
    [ScheduleKindNotRegisteredError, 500, opaqueInternalErrorBody],
    [ScheduleKindAlreadyRegisteredError, 500, opaqueInternalErrorBody],
    [ScheduleKindRegistryFrozenError, 500, opaqueInternalErrorBody],
    // `ScheduleError` is the abstract base — listed LAST among
    // schedule-package entries so concrete subclasses (e.g.
    // `InvalidCronExprError`) match first.
    [ScheduleError, 400],
  ],
  // Task-dispatch fallthrough: the task-kind handler surfaces a
  // `TaskOperationError` carrying the task union `type` as `.code`
  // (missing agent, resolver crash, or any dispatch failure on
  // `POST /:sid/run`). Resolve status + body from the shared task-error
  // table so the wire `code` matches the task routes.
  codeStatuses: [...taskUnionCodeStatuses],
};
