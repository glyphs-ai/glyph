import type { HandlerFault, ScheduleKindHandler } from "@glyphs-ai/schedule";
import type { TaskId, TaskModule } from "@glyphs-ai/task";
import type { WorkflowModule } from "@glyphs-ai/workflow";
import { WorkflowBriefSchema } from "@glyphs-ai/workflow";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import { taskAgentResolutionFailed } from "./_task-operation-error.js";

/** Concrete workflow-target shape this handler validates + persists as opaque `data`. */
interface WorkflowTargetData {
  readonly coordinatorAgent: string;
  readonly brief: string;
  readonly details?: string;
}

/** RFC 7396 deep-merge patch for a workflow target (`null` deletes an optional). */
interface WorkflowTargetPatch {
  readonly coordinatorAgent?: string;
  readonly brief?: string;
  readonly details?: string | null;
}

interface CatalogAgent {
  readonly dependencies?: { readonly agents?: readonly { readonly fqn: string }[] };
}

interface CatalogAgentLookup {
  getAgent(fqn: string): Promise<CatalogAgent | null>;
}

/**
 * Sole module knowing about all of `@glyphs-ai/schedule`,
 * `@glyphs-ai/workflow`, `@glyphs-ai/task`, AND `@glyphs-ai/catalog`.
 * This is the only edge in the cross-pkg import graph where they meet —
 * the schedule pkg stays kind-agnostic; the workflow pkg stays unaware
 * of schedules' SQL; the task pkg is consumed only for the node-task
 * cascade on schedule deletion (the workflow substrate's own
 * `deleteWorkflow` drops workflow/node/edge rows but not the per-node
 * backing tasks); and the catalog pkg is consumed only here for
 * coordinator-agent eligibility checking.
 *
 * Responsibilities (the kind-specific concerns the schedule pkg
 * deliberately doesn't carry, absorbed here):
 *
 *   - workflow-target shape validation
 *   - coordinator-agent existence + coord-eligibility lookup
 *   - RFC 7396 deep-merge of workflow target patches
 *   - origin/originId synthesis for `WorkflowService.createWorkflow`
 *   - lifecycle delegation for `hasInFlightForSchedule` /
 *     `deleteForSchedule`
 *
 * `validate(_, { changedKeys })` skips the async catalog lookup when
 * `coordinatorAgent` is not in `changedKeys` — this preserves the
 * patch-when-catalog-down invariant: a sparse "edit only brief" patch
 * must not fail because the catalog is unhealthy.
 *
 * Error policy mirrors the task handler and the `/workflows` create
 * path: catalog *resolution / infra* failure surfaces as the task
 * `AgentResolutionFailed` union (→ 500, opaque body) so a transient
 * catalog outage never masquerades as a 400 bad-request that leaks the
 * underlying error string. Genuine validation failures (unknown
 * coordinatorAgent, not coord-eligible, malformed brief) stay
 * `WorkflowTargetInvalid` atoms (→ 400 with message).
 */
export function makeWorkflowKindHandler(opts: {
  readonly workflows: WorkflowModule;
  readonly tasks: TaskModule;
  readonly catalog: CatalogAgentLookup;
}): ScheduleKindHandler {
  const workflows = opts.workflows;
  const tasks = opts.tasks;
  const catalog = opts.catalog;

  return {
    validate(raw, opts) {
      return new ResultAsync(
        (async (): Promise<Result<unknown, HandlerFault>> => {
          if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            return err({
              cause: {
                type: "WorkflowTargetInvalid",
                message: "Workflow target data must be an object",
              } satisfies WorkflowTargetInvalid,
            });
          }
          const obj = raw as Record<string, unknown>;
          if (
            typeof obj.coordinatorAgent !== "string" ||
            obj.coordinatorAgent.trim().length === 0
          ) {
            return err({
              cause: {
                type: "WorkflowTargetInvalid",
                message: "Workflow target requires non-empty coordinatorAgent",
              } satisfies WorkflowTargetInvalid,
            });
          }
          const briefResult = WorkflowBriefSchema.safeParse(obj.brief);
          if (!briefResult.success) {
            return err({
              cause: {
                type: "WorkflowTargetInvalid",
                message: `Workflow target ${briefResult.error.issues[0]?.message ?? "has an invalid brief"}`,
              } satisfies WorkflowTargetInvalid,
            });
          }
          if (obj.details !== undefined && typeof obj.details !== "string") {
            return err({
              cause: {
                type: "WorkflowTargetInvalid",
                message: "Workflow target details, when set, must be a string",
              } satisfies WorkflowTargetInvalid,
            });
          }

          // Catalog existence + coord-eligibility — skip if changedKeys
          // excludes "coordinatorAgent". changedKeys === undefined means
          // "full validate" (the create path); the patch path passes the
          // exact set of changed keys so a brief-only edit skips the
          // catalog round-trip.
          const mustCheckAgent =
            opts?.changedKeys === undefined || opts.changedKeys.includes("coordinatorAgent");
          if (mustCheckAgent) {
            let found: Awaited<ReturnType<typeof catalog.getAgent>>;
            try {
              found = await catalog.getAgent(obj.coordinatorAgent as string);
            } catch (cause) {
              // Catalog unreachable / resolver crash — infrastructure, not
              // bad caller input. Surface as the task pkg's resolution
              // error (→ 500 opaque) rather than a 400 that would falsely
              // blame the caller and echo the raw error message.
              return err({
                cause: taskAgentResolutionFailed(obj.coordinatorAgent as string, cause),
              });
            }
            if (found === null) {
              return err({
                cause: {
                  type: "WorkflowTargetInvalid",
                  message: `Coordinator agent "${obj.coordinatorAgent}" not found in catalog`,
                } satisfies WorkflowTargetInvalid,
              });
            }
            // Coord-eligibility: the agent must declare a non-empty
            // `dependencies.agents` dispatch menu (same check the coord
            // runner performs at validate time).
            const menu = found.dependencies?.agents ?? [];
            if (menu.length === 0) {
              return err({
                cause: {
                  type: "WorkflowTargetInvalid",
                  message: `Agent "${obj.coordinatorAgent}" is not coordinator-eligible (no dependencies.agents dispatch menu)`,
                } satisfies WorkflowTargetInvalid,
              });
            }
          }

          const validated: WorkflowTargetData = {
            coordinatorAgent: obj.coordinatorAgent as string,
            brief: briefResult.data,
            ...(obj.details !== undefined ? { details: obj.details as string } : {}),
          };
          return ok(validated);
        })(),
      );
    },

    mergePatch(existing, patch) {
      const e = existing as WorkflowTargetData;
      const p = patch as WorkflowTargetPatch;
      const changedKeys: string[] = [];

      let coordinatorAgent = e.coordinatorAgent;
      if (p.coordinatorAgent !== undefined) {
        changedKeys.push("coordinatorAgent");
        coordinatorAgent = p.coordinatorAgent;
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

      const data: WorkflowTargetData = {
        coordinatorAgent,
        brief,
        ...(details !== undefined ? { details } : {}),
      };
      return { data, changedKeys };
    },

    dispatch({ scheduleId, firedAt, data }) {
      const t = data as WorkflowTargetData;
      return workflows.createWorkflow
        .execute({
          coordinatorAgent: t.coordinatorAgent,
          brief: t.brief,
          ...(t.details !== undefined ? { details: t.details } : {}),
          origin: "schedule",
          originId: scheduleId,
          metadata: { firedAt },
        })
        .map((created) => ({ id: created.workflowId }))
        .mapErr((cause): HandlerFault => ({ cause }));
    },

    // Both lookups narrow to the schedule's workflows in SQL via the
    // typed `(origin, origin_id)` column pair (served by
    // `workflows_origin_pair_idx`), so the DB returns only the rows for
    // this schedule — no full `origin: "schedule"` scan + client-side
    // `metadata.scheduleId` filter.
    hasInFlightForSchedule(scheduleId) {
      return workflows.listWorkflows
        .execute({ origin: "schedule", originId: scheduleId })
        .map((matched) => matched.some((wf) => wf.status === "running"))
        .mapErr((cause): HandlerFault => ({ cause }));
    },

    deleteForSchedule(scheduleId) {
      return new ResultAsync(
        (async (): Promise<Result<{ deletedCount: number }, HandlerFault>> => {
          const matched = await workflows.listWorkflows.execute({
            origin: "schedule",
            originId: scheduleId,
          });
          if (matched.isErr()) return err({ cause: matched.error });
          const terminal = matched.value.filter((wf) => wf.status !== "running");
          let deletedCount = 0;
          for (const wf of terminal) {
            // The workflow substrate's `deleteWorkflow` drops only its own
            // workflow/node/edge rows — each node's backing task row + its
            // workdir live in the task module and must be cascaded here, or
            // they outlive the schedule (orphaned rows + disk). This mirrors
            // the canonical `DELETE /workflows/:wfid` route's cascade and
            // matches the task kind's purge-on-schedule-delete semantics.
            const snapshotResult = await workflows.getDag.execute({ workflowId: wf.id });
            if (snapshotResult.isErr()) return err({ cause: snapshotResult.error });
            const snapshot = snapshotResult.value;
            // Defense-in-depth against the post-finishWorkflow coord-task
            // race: a workflow can read terminal while a node task is still
            // wrapping up. Skip the whole workflow (no partial delete) and
            // let a later sweep reclaim it — the same holdout the DELETE
            // route applies, and the "never destroy in-flight" invariant the
            // schedule cascade promises.
            let hasInFlightNode = false;
            for (const node of snapshot.nodes) {
              const inFlight = await tasks.hasInFlightByOrigin.execute({
                origin: "workflow",
                originId: node.id,
              });
              if (inFlight.isErr()) return err({ cause: inFlight.error });
              if (inFlight.value) {
                hasInFlightNode = true;
                break;
              }
            }
            if (hasInFlightNode) continue;
            for (const node of snapshot.nodes) {
              const linkedResult = await tasks.findLatestByOrigin.execute({
                origin: "workflow",
                originId: node.id,
              });
              if (linkedResult.isErr()) return err({ cause: linkedResult.error });
              const linked = linkedResult.value;
              if (linked === null) continue;
              const deleteResult = await tasks.deleteTask.execute({
                id: linked.id as TaskId,
                purge: true,
              });
              if (deleteResult.isErr()) return err({ cause: deleteResult.error });
            }
            const deleted = await workflows.deleteWorkflow.execute({
              workflowId: wf.id,
              purgeDir: true,
            });
            if (deleted.isErr()) return err({ cause: deleted.error });
            deletedCount++;
          }
          return ok({ deletedCount });
        })(),
      );
    },
  };
}

export type WorkflowTargetInvalid = {
  readonly type: "WorkflowTargetInvalid";
  readonly message: string;
};
