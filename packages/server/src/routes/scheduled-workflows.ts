import type { WorkflowHeader } from "@glyphs-ai/api";
import { WorkflowHeaderSchema } from "@glyphs-ai/api";
import type { WorkflowModule } from "@glyphs-ai/workflow";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { respondWorkflowError, workflowsErrorPolicy } from "./_error-policies/workflows.js";
import { createApiApp, errorResponse, jsonResponse } from "./_openapi.js";
import { projectWorkflowHeader } from "./_workflow-projection.js";

/**
 * Resolver passed in by the mount point so route handlers pull the
 * workspace-scoped WorkflowService out of Hono's per-request context.
 */
type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowModule;

/**
 * Routes for `/api/workspaces/:id/scheduled-workflows`.
 *
 * Mounted at the parent in `index.ts`; paths here are relative to that
 * mount. This route is **schedule-origin-only by construction** — the
 * filter is hardcoded to workflows whose `origin` is `"schedule"`.
 * Splitting at the URL layer (instead of via a `?origin=` discriminator
 * on `/workflows`) means each origin's caller surface gets a route whose
 * URL IS the contract; callers cannot accidentally widen the result set.
 */
export function scheduledWorkflowsRoutes(
  resolveWorkflowService: WorkflowServiceResolver,
): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["workflows"],
      summary: "List schedule-origin workflows",
      request: { query: z.object({ scheduleId: z.string().optional() }) },
      responses: {
        200: jsonResponse(WorkflowHeaderSchema.array(), "Workflows"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const scheduleId = c.req.query("scheduleId");

      try {
        const svc = resolveWorkflowService(c);
        // Narrow to schedule-origin workflows — optionally to a single
        // schedule — through the typed `(origin, origin_id)` column pair,
        // so the `?scheduleId=` filter is served from
        // `workflows_origin_pair_idx` with no `metadata` JSON probing.
        const [filtered, awaitingMap] = await Promise.all([
          svc.listWorkflows.execute({
            origin: "schedule",
            ...(scheduleId !== undefined ? { originId: scheduleId } : {}),
          }),
          svc.countAwaitingHuman.execute({}),
        ]);
        if (filtered.isErr()) throw filtered.error;
        if (awaitingMap.isErr()) throw awaitingMap.error;
        const awaiting = new Map(Object.entries(awaitingMap.value));
        // Project to wire headers — same entity→wire boundary every other
        // workflow route uses. `iterationCount` is omitted (O(workflows)
        // list semantics); `awaitingHumanCount` comes from the batch query.
        const wire: readonly WorkflowHeader[] = filtered.value.map((wf) =>
          projectWorkflowHeader(wf, undefined, awaiting.get(wf.id) ?? 0),
        );
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "scheduled-workflows.list",
          policy: workflowsErrorPolicy,
        });
      }
    },
  );

  return app;
}
