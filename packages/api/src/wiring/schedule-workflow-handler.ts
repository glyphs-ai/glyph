import type { CatalogService } from "@glyphs-ai/catalog";
import type { WorkflowTargetData, WorkflowTargetPatch } from "@glyphs-ai/contracts";
import type { ScheduleKindHandler } from "@glyphs-ai/schedule";
import type { WorkflowService } from "@glyphs-ai/workflow";

/**
 * Sole module knowing about all of `@glyphs-ai/schedule`,
 * `@glyphs-ai/workflow`, AND `@glyphs-ai/catalog`. This is the only
 * edge in the cross-pkg import graph where the three meet — the
 * schedule pkg stays kind-agnostic; the workflow pkg stays unaware of
 * schedules' SQL; and the catalog pkg is consumed only here for
 * coordinator-agent eligibility checking.
 *
 * Responsibilities (the kind-specific concerns the schedule pkg
 * deliberately doesn't carry, absorbed here):
 *
 *   - workflow-target shape validation
 *   - coordinator-agent existence + coord-eligibility lookup
 *   - RFC 7396 deep-merge of workflow target patches
 *   - origin/metadata synthesis for `WorkflowService.createWorkflow`
 *   - lifecycle delegation for `hasInFlightForSchedule` /
 *     `deleteForSchedule`
 *
 * `validate(_, { changedKeys })` skips the async catalog lookup when
 * `coordinatorAgent` is not in `changedKeys` — this preserves the
 * patch-when-catalog-down invariant: a sparse "edit only brief" patch
 * must not fail because the catalog is unhealthy.
 *
 * Agent errors use workflow-scope classes directly so downstream error
 * policies share canonical matches with the `/workflows` create path.
 */
export function makeWorkflowKindHandler(opts: {
  readonly workflows: WorkflowService;
  readonly catalog: CatalogService;
}): ScheduleKindHandler {
  const workflows = opts.workflows;
  const catalog = opts.catalog;

  return {
    async validate(raw, opts) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new WorkflowScheduleTargetError("Workflow target data must be an object");
      }
      const obj = raw as Record<string, unknown>;
      if (typeof obj.coordinatorAgent !== "string" || obj.coordinatorAgent.trim().length === 0) {
        throw new WorkflowScheduleTargetError(
          "Workflow target requires non-empty coordinatorAgent",
        );
      }
      if (typeof obj.brief !== "string" || obj.brief.trim().length === 0) {
        throw new WorkflowScheduleTargetError("Workflow target requires non-empty brief");
      }
      if (obj.brief.includes("\n") || obj.brief.includes("\r")) {
        throw new WorkflowScheduleTargetError(
          "Workflow target brief must be a single line (no newline characters); pass long content via details",
        );
      }
      if (obj.brief.trim().length > 200) {
        throw new WorkflowScheduleTargetError(
          "Workflow target brief must be 200 characters or fewer",
        );
      }
      if (obj.details !== undefined && typeof obj.details !== "string") {
        throw new WorkflowScheduleTargetError(
          "Workflow target details, when set, must be a string",
        );
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
        } catch (err) {
          throw new WorkflowScheduleTargetError(
            `Failed to resolve coordinator agent "${obj.coordinatorAgent}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (found === null) {
          throw new WorkflowScheduleTargetError(
            `Coordinator agent "${obj.coordinatorAgent}" not found in catalog`,
          );
        }
        // Coord-eligibility: the agent must declare a non-empty
        // `dependencies.agents` dispatch menu (same check the coord
        // runner performs at validate time).
        const menu = found.dependencies?.agents ?? [];
        if (menu.length === 0) {
          throw new WorkflowScheduleTargetError(
            `Agent "${obj.coordinatorAgent}" is not coordinator-eligible (no dependencies.agents dispatch menu)`,
          );
        }
      }

      const validated: WorkflowTargetData = {
        coordinatorAgent: obj.coordinatorAgent as string,
        brief: obj.brief as string,
        ...(obj.details !== undefined ? { details: obj.details as string } : {}),
      };
      return validated;
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

    async dispatch({ scheduleId, firedAt, data }) {
      const t = data as WorkflowTargetData;
      const result = await workflows.createWorkflow({
        coordinatorAgent: t.coordinatorAgent,
        brief: t.brief,
        ...(t.details !== undefined ? { details: t.details } : {}),
        metadata: { scheduleId, firedAt },
      });
      return { id: result.workflowId };
    },

    async hasInFlightForSchedule(scheduleId) {
      const all = await workflows.list();
      return all.some((wf) => wf.status === "running" && wf.metadata.scheduleId === scheduleId);
    },

    async deleteForSchedule(scheduleId) {
      const all = await workflows.list();
      const terminal = all.filter(
        (wf) => wf.status !== "running" && wf.metadata.scheduleId === scheduleId,
      );
      let deletedCount = 0;
      for (const wf of terminal) {
        await workflows.deleteWorkflow(wf.id);
        deletedCount++;
      }
      return { deletedCount };
    },
  };
}

/**
 * Wire-shape error for malformed workflow target data. Lives next to
 * the handler (rather than in `@glyphs-ai/schedule`) because the
 * schedule pkg is kind-agnostic. The schedules-route's error policy
 * needs a 400 row for this; we set `.name = "WorkflowScheduleTargetError"`
 * so the policy's instanceof match wires up cleanly.
 */
export class WorkflowScheduleTargetError extends Error {
  override readonly name = "WorkflowScheduleTargetError";
}
