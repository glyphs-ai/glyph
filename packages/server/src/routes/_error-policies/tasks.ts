/**
 * Per-domain error policy for the tasks + scheduled-tasks routes.
 *
 * These (class, status) pairs are the route contract. Keep subclasses
 * before base classes and add a row whenever a public task/runtime
 * error can cross this HTTP boundary.
 *
 * `EntryNotReadyError` carries a class-stable body (`{ error, code,
 * agent, reason }`) lifted from the inline branch in `routes/tasks.ts`.
 * The dashboard's `formatEntryNotReadyHint` CTA branches on `reason`,
 * so the structured envelope MUST be preserved.
 *
 * `AgentResolutionFailedError` carries a deliberately opaque
 * class-stable body — its `cause` may contain DB host paths, stack
 * frames, or other internals. The real diagnostics land in the
 * server log via `logFault()`; the wire response is collapsed to
 * `{ error: "internal error", code: "AgentResolutionFailedError" }`
 * so dashboards can differentiate it from a generic 500 without
 * depending on the message.
 *
 * `InvalidTransition`'s status is here but its body is route-dependent
 * (`{ ..., transition: "cancel" | "delete" }`) and is built per-call
 * via `RespondErrorOpts.customBody`.
 */

import { RuntimeHeadlessLaunchFailed, RuntimeReadActivityInvalidArgs } from "@glyphs-ai/runtime";
import {
  AgentNotFoundError,
  AgentResolutionFailedError,
  CorruptedTaskError,
  DispatchKernelEnvCollisionError,
  EntryNotReadyError,
  InvalidTaskIdError,
  InvalidTransition,
  ManagerShuttingDownError,
  RuntimeDoesNotSupportTasksError,
  TaskIdAllocationFailedError,
  TaskNotFoundError,
} from "@glyphs-ai/task";
import type { ErrorPolicy } from "../_respond-error.js";
import { opaqueAgentResolutionBody } from "./_shared-bodies.js";

export const tasksErrorPolicy: ErrorPolicy = {
  name: "tasks",
  statuses: [
    [InvalidTaskIdError, 400],
    [TaskNotFoundError, 404],
    [AgentNotFoundError, 400],
    [AgentResolutionFailedError, 500, opaqueAgentResolutionBody],
    [RuntimeDoesNotSupportTasksError, 400],
    [
      EntryNotReadyError,
      409,
      (err) => {
        const e = err as EntryNotReadyError;
        return {
          error: e.message,
          code: e.name,
          agent: e.agent,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
        };
      },
    ],
    [InvalidTransition, 409],
    [ManagerShuttingDownError, 503],
    [DispatchKernelEnvCollisionError, 400],
    [TaskIdAllocationFailedError, 500],
    [RuntimeHeadlessLaunchFailed, 500],
    [RuntimeReadActivityInvalidArgs, 400],
    [CorruptedTaskError, 500],
  ],
};
