import type { HandlerFault, ScheduleKindHandler } from "@glyphs-ai/schedule";
import type { TaskModule } from "@glyphs-ai/task";
import { TaskBriefSchema } from "@glyphs-ai/task";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import { taskAgentNotFound, taskAgentUnresolvable } from "./_task-operation-error.js";

/** Concrete task-target shape this handler validates + persists as opaque `data`. */
interface TaskTargetData {
  readonly agent: string;
  readonly brief: string;
  readonly details?: string;
  readonly runtime?: string;
}

/** RFC 7396 deep-merge patch for a task target (`null` deletes an optional). */
interface TaskTargetPatch {
  readonly agent?: string;
  readonly brief?: string;
  readonly details?: string | null;
  readonly runtime?: string | null;
}

interface CatalogAgentLookup {
  getAgent(fqn: string): Promise<unknown | null>;
}

/**
 * Sole module knowing about all of `@glyphs-ai/schedule`,
 * `@glyphs-ai/task`, AND `@glyphs-ai/catalog`. This is the only edge in
 * the cross-pkg import graph where the three meet — the schedule pkg
 * stays kind-agnostic; the task pkg stays unaware of schedules' SQL;
 * and the catalog pkg is consumed only here for agent existence.
 *
 * Responsibilities (the kind-specific concerns the schedule pkg
 * deliberately doesn't carry, absorbed here):
 *
 *   - task-target shape validation
 *   - agent existence lookup
 *   - RFC 7396 deep-merge of task target patches
 *   - origin/originId synthesis for `tasks.dispatchTask.execute`
 *   - lifecycle delegation for `hasInFlightForSchedule` /
 *     `deleteForSchedule`
 *
 * `validate(_, { changedKeys })` skips the async catalog lookup when
 * `agent` is not in `changedKeys` — this preserves the patch-when-
 * catalog-down invariant: a sparse "edit only brief" patch must not
 * fail because the catalog is unhealthy.
 *
 * Agent-lookup failures propagate task union errors so downstream policies
 * use the same status/body mapping as the task routes.
 */
export function makeTaskKindHandler(opts: {
  readonly tasks: TaskModule;
  readonly catalog: CatalogAgentLookup;
}): ScheduleKindHandler {
  const tasks = opts.tasks;
  const catalog = opts.catalog;

  return {
    validate(raw, opts) {
      return new ResultAsync(
        (async (): Promise<Result<unknown, HandlerFault>> => {
          if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            return err({
              cause: {
                type: "TaskTargetInvalid",
                message: "Task target data must be an object",
              } satisfies TaskTargetInvalid,
            });
          }
          const obj = raw as Record<string, unknown>;
          if (typeof obj.agent !== "string" || obj.agent.trim().length === 0) {
            return err({
              cause: {
                type: "TaskTargetInvalid",
                message: "Task target requires non-empty agent",
              } satisfies TaskTargetInvalid,
            });
          }
          const briefResult = TaskBriefSchema.safeParse(obj.brief);
          if (!briefResult.success) {
            return err({
              cause: {
                type: "TaskTargetInvalid",
                message: `Task target ${briefResult.error.issues[0]?.message ?? "has an invalid brief"}`,
              } satisfies TaskTargetInvalid,
            });
          }
          if (obj.details !== undefined && typeof obj.details !== "string") {
            return err({
              cause: {
                type: "TaskTargetInvalid",
                message: "Task target details, when set, must be a string",
              } satisfies TaskTargetInvalid,
            });
          }
          if (
            obj.runtime !== undefined &&
            (typeof obj.runtime !== "string" || obj.runtime.trim().length === 0)
          ) {
            return err({
              cause: {
                type: "TaskTargetInvalid",
                message: "Task target runtime, when set, must be a non-empty string",
              } satisfies TaskTargetInvalid,
            });
          }

          // Catalog existence — skip if changedKeys excludes "agent".
          // changedKeys === undefined means "full validate" (the create
          // path); the patch path passes the exact set of changed keys
          // so a brief-only edit skips the catalog round-trip.
          const mustCheckAgent =
            opts?.changedKeys === undefined || opts.changedKeys.includes("agent");
          if (mustCheckAgent) {
            let found: Awaited<ReturnType<typeof catalog.getAgent>>;
            try {
              found = await catalog.getAgent(obj.agent as string);
            } catch (cause) {
              return err({ cause: taskAgentUnresolvable(obj.agent as string, cause) });
            }
            if (found === null) return err({ cause: taskAgentNotFound(obj.agent as string) });
          }

          const validated: TaskTargetData = {
            agent: obj.agent as string,
            brief: briefResult.data,
            ...(obj.details !== undefined ? { details: obj.details as string } : {}),
            ...(obj.runtime !== undefined ? { runtime: obj.runtime as string } : {}),
          };
          return ok(validated);
        })(),
      );
    },

    mergePatch(existing, patch) {
      // Pre-condition (per ScheduleKindHandler contract): `existing`
      // is a value our own `validate` produced, so direct cast is
      // safe. The `patch` is the route-validated TaskTargetPatch
      // (server's validateTaskTargetPatch enforced types before the
      // call); we still treat it defensively as readonly opaque
      // payload.
      const e = existing as TaskTargetData;
      const p = patch as TaskTargetPatch;
      const changedKeys: string[] = [];

      let agent = e.agent;
      if (p.agent !== undefined) {
        changedKeys.push("agent");
        agent = p.agent;
      }
      let brief = e.brief;
      if (p.brief !== undefined) {
        changedKeys.push("brief");
        brief = p.brief;
      }

      let details: string | undefined;
      if (p.details === null) {
        if (e.details !== undefined) changedKeys.push("details");
        details = undefined;
      } else if (p.details !== undefined) {
        changedKeys.push("details");
        details = p.details;
      } else {
        details = e.details;
      }

      let runtime: string | undefined;
      if (p.runtime === null) {
        if (e.runtime !== undefined) changedKeys.push("runtime");
        runtime = undefined;
      } else if (p.runtime !== undefined) {
        changedKeys.push("runtime");
        runtime = p.runtime;
      } else {
        runtime = e.runtime;
      }

      const data: TaskTargetData = {
        agent,
        brief,
        ...(details !== undefined ? { details } : {}),
        ...(runtime !== undefined ? { runtime } : {}),
      };
      return { data, changedKeys };
    },

    dispatch({ scheduleId, firedAt, data }) {
      const t = data as TaskTargetData;
      return tasks.dispatchTask
        .execute({
          agent: t.agent,
          brief: TaskBriefSchema.parse(t.brief),
          // `{ details: undefined }` is NOT equivalent to omitting the
          // key under exactOptionalPropertyTypes; conditional spread.
          ...(t.details !== undefined ? { details: t.details } : {}),
          ...(t.runtime !== undefined ? { runtime: t.runtime } : {}),
          origin: "schedule",
          originId: scheduleId,
          metadata: { firedAt },
        })
        .map((dispatched) => ({ id: dispatched.id }))
        .mapErr((cause): HandlerFault => ({ cause }));
    },

    hasInFlightForSchedule(scheduleId) {
      return tasks.hasInFlightByOrigin
        .execute({ origin: "schedule", originId: scheduleId })
        .mapErr((cause): HandlerFault => ({ cause }));
    },

    deleteForSchedule(scheduleId) {
      return tasks.deleteTerminalByOrigin
        .execute({ origin: "schedule", originId: scheduleId })
        .mapErr((cause): HandlerFault => ({ cause }));
    },
  };
}

export type TaskTargetInvalid = {
  readonly type: "TaskTargetInvalid";
  readonly message: string;
};
