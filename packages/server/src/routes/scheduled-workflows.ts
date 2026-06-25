import type { WorkflowHeader } from "@glyphs-ai/api";
import type { WorkflowService } from "@glyphs-ai/workflow";
import { Hono } from "hono";
import { workflowsErrorPolicy } from "./_error-policies/workflows.js";
import { respondError } from "./_respond-error.js";
import { projectWorkflowHeader } from "./_workflow-projection.js";

/**
 * Resolver passed in by the mount point so route handlers pull the
 * workspace-scoped WorkflowService out of Hono's per-request context.
 */
type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowService;

/**
 * Routes for `/api/workspaces/:id/scheduled-workflows`.
 *
 * Mounted at the parent in `index.ts`; paths here are relative to that
 * mount. This route is **schedule-origin-only by construction** — the
 * filter is hardcoded to workflows whose `metadata.scheduleId` is set.
 * Splitting at the URL layer (instead of via a `?origin=` discriminator
 * on `/workflows`) means each origin's caller surface gets a route whose
 * URL IS the contract; callers cannot accidentally widen the result set.
 */
export function scheduledWorkflowsRoutes(resolveWorkflowService: WorkflowServiceResolver): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const scheduleId = c.req.query("scheduleId");

    try {
      const svc = resolveWorkflowService(c);
      const [all, awaitingMap] = await Promise.all([
        svc.list({ origin: "schedule" }),
        svc.countAwaitingHumanByWorkflow(),
      ]);
      // Optionally narrow to a specific scheduleId via metadata.
      const filtered =
        scheduleId !== undefined ? all.filter((wf) => wf.metadata.scheduleId === scheduleId) : all;
      // Project to wire headers — same entity→wire boundary every other
      // workflow route uses. `iterationCount` is omitted (O(workflows)
      // list semantics); `awaitingHumanCount` comes from the batch query.
      const wire: readonly WorkflowHeader[] = filtered.map((wf) =>
        projectWorkflowHeader(wf, undefined, awaitingMap.get(wf.id) ?? 0),
      );
      return c.json(wire);
    } catch (err) {
      return respondError(c, err, {
        route: "scheduled-workflows.list",
        policy: workflowsErrorPolicy,
      });
    }
  });

  return app;
}
