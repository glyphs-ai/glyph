/**
 * Routes for `/api/workspaces/:id/workflows`. Workspace-scoped read
 * + lifecycle + coord-callback mutation surface over `WorkflowService`,
 * plus dashboard-facing artifact list / static-bytes routes that
 * bridge the substrate's on-disk artifact dirs to the browser.
 *
 * The substrate is kind-agnostic and stores nodes opaquely as
 * `{ kind, spec: unknown }`; the wire-layer projection
 * (`_workflow-projection.ts`) flattens the per-kind shapes for the
 * dashboard / CLI and enriches each node with its dispatched
 * `taskId` via the task service reverse-lookup (Mode B drill-down).
 *
 * Resolver-injection pattern matches `routes/schedules.ts` /
 * `routes/tasks.ts`: the mount point in `server/src/index.ts` hands
 * in three functions that pull the workspace-scoped services and the
 * workspace fs root out of Hono's per-request context. The route
 * file never touches workspace resolution, only the workflow + tasks
 * surfaces and the resolved `workspaceDir`.
 *
 * ## Endpoints
 *
 *   - `GET    /`                          — list workflows; `?q=`, `?coordinatorAgent=`, `?createdSince=` narrow
 *   - `POST   /`                          — seed a workflow + its initial coord
 *   - `GET    /:wfid`                     — header only (with `iterationCount`)
 *   - `DELETE /:wfid`                     — delete a terminal workflow (`?purge=1` for hard delete)
 *   - `GET    /:wfid/dag`                 — full snapshot (header + nodes + edges) with taskId enrichment
 *   - `GET    /:wfid/nodes/:nid`          - single node (taskId enriched) without the full dag
 *   - `POST   /:wfid/cancel`              — external cancel; returns updated header
 *   - `GET    /:wfid/artifacts`           — list workflow-summary + per-node artifacts
 *   - `GET    /:wfid/artifacts/:encoded`  — static bytes for one artifact
 *   - `POST   /:wfid/nodes`               — add a single node
 *   - `POST   /:wfid/edges`               — add a single edge
 *   - `POST   /:wfid/subgraph`            — batch insert N nodes + M edges
 *   - `POST   /:wfid/nodes/:nid/cancel`   — cancel a worker-kind node
 *   - `POST   /:wfid/nodes/:nid/respond`  - answer a waiting human-kind node
 *   - `POST   /:wfid/finish`              — flip workflow terminal
 *   - `DELETE /:wfid/nodes/:nid`          — delete a not_started node
 *   - `DELETE /:wfid/edges/:from/:to`     — delete a not_started edge
 *   - `PATCH  /:wfid/nodes/:nid/spec`     — re-validate + replace spec
 *
 * ## Workflow lifecycle gate (mutation routes)
 *
 * Every mutation route forwards `workflowId` from the URL path and
 * NOTHING ELSE about the caller. The substrate re-checks the workflow's
 * lifecycle status inside its mutation tx and rejects mutations against
 * a terminal workflow with `WorkflowAlreadyTerminalError` → 409 from the
 * policy below.
 *
 * ## iterationCount derivation
 *
 *   - `GET /`     — projected as `0` per row to keep the endpoint
 *                   O(workflows). Computing the true value would
 *                   require a per-row coord-count query (N+1). Clients
 *                   that need the accurate count fetch the header.
 *   - `GET /:wfid` and `GET /:wfid/dag` — derived from the workflow's
 *                   coord-node count via `deriveIterationCount`.
 *
 * ## Cancel response
 *
 * `cancelWorkflow` returns `Promise<void>`; the route does a second
 * `getDag` after the cancel to project the post-cancel header (so
 * the caller observes the new `endedAt` / `status` without a second
 * round-trip).
 *
 * ## Artifact route encoding
 *
 * `GET /:wfid/artifacts/:encodedPath` reads a single Hono path
 * segment, so multi-segment paths (`summary/foo/bar.md`) MUST be
 * url-encoded with `%2F` for `/`. Two sentinels:
 *   - `summary/<rest>` — `<workflowDir>/artifact/<rest>` (no-store)
 *   - `nodes/<nodeId>/<rest>` — `<tasksRoot>/<taskId>/artifact/<rest>`
 *     (`Cache-Control: max-age=300` once the owning task is terminal,
 *     `no-store` while it is still running so the dashboard reloads
 *     mid-stream files cleanly).
 * Any other prefix yields 400.
 */

import type {
  RespondHumanNodeRequest,
  WorkflowDag,
  WorkflowHeader,
  WorkflowStatus,
} from "@glyphs-ai/api";
import {
  AddEdgeRequestSchema,
  AddEdgeResponseSchema,
  AddNodeRequestSchema,
  AddNodeResponseSchema,
  AddSubgraphRequestSchema,
  AddSubgraphResponseSchema,
  CancelWorkflowRequestSchema,
  CreateWorkflowRequestSchema,
  FinishWorkflowRequestSchema,
  ReplaceNodeSpecRequestSchema,
  RespondHumanNodeRequestSchema,
  TaskOperationError,
  WorkflowArtifactsResponseSchema,
  WorkflowDagSchema,
  WorkflowHeaderSchema,
  WorkflowNodeSchema,
} from "@glyphs-ai/api";
import type { TaskModule } from "@glyphs-ai/task";
import type { WorkflowId, WorkflowModule, WorkflowNodeId } from "@glyphs-ai/workflow";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Result } from "neverthrow";
import {
  respondWorkflowError,
  type WorkflowRouteError,
  workflowCustomDeleteBody,
  workflowsErrorPolicy,
} from "./_error-policies/workflows.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "./_openapi.js";
import { logEvent } from "./_shared.js";
import {
  countAwaitingHuman,
  iterationCountForNodes,
  projectWorkflowDag,
  projectWorkflowHeader,
  projectWorkflowNodeWithTaskId,
} from "./_workflow-projection.js";
import { handleListArtifacts, handleStreamArtifact } from "./workflows/_artifacts.js";
import { resolveNodeRef, validateCreatedSinceQuery } from "./workflows/_validators.js";

type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowModule;
type WorkflowTasksResolver = (c: import("hono").Context) => TaskModule;
type WorkflowWorkspaceDirResolver = (c: import("hono").Context) => string;

function unwrapWorkflow<T, E extends WorkflowRouteError>(result: Result<T, E>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}

export function workflowsRoutes(
  resolve: WorkflowServiceResolver,
  resolveTasks: WorkflowTasksResolver,
  resolveWorkspaceDir: WorkflowWorkspaceDirResolver,
): OpenAPIHono {
  const app = createApiApp();
  const artifactDeps = { resolve, resolveTasks, resolveWorkspaceDir };

  // ── GET / — list with optional q / coordinatorAgent / createdSince ─
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["workflows"],
      summary: "List workflows",
      request: {
        query: z.object({
          q: z.string().optional(),
          coordinatorAgent: z.string().optional(),
          createdSince: z.string().optional(),
        }),
      },
      responses: {
        200: jsonResponse(WorkflowHeaderSchema.array(), "Workflows"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const createdSinceResult = validateCreatedSinceQuery(c.req.query("createdSince"));
      if (!createdSinceResult.ok) {
        return c.json({ error: createdSinceResult.error, code: "WorkflowError" }, 400);
      }
      const q = c.req.query("q");
      const coordinatorAgent = c.req.query("coordinatorAgent");
      const opts: {
        coordinatorAgent?: string;
        createdSince?: string;
        idLike?: string;
        origin?: readonly ("standalone" | "schedule")[];
      } = { origin: ["standalone"] };
      if (q !== undefined && q !== "") opts.idLike = q;
      if (coordinatorAgent !== undefined && coordinatorAgent !== "") {
        opts.coordinatorAgent = coordinatorAgent;
      }
      if (createdSinceResult.value !== undefined) opts.createdSince = createdSinceResult.value;
      try {
        const [listResult, awaitingResult] = await Promise.all([
          resolve(c).listWorkflows.execute(opts),
          resolve(c).countAwaitingHuman.execute({}),
        ]);
        const list = unwrapWorkflow(listResult);
        const awaitingMap = new Map(Object.entries(unwrapWorkflow(awaitingResult)));
        // `iterationCount` is omitted from list rows to keep the
        // endpoint O(workflows): computing it per row would require a
        // DAG snapshot per workflow. Clients that need the accurate
        // count fetch the header via `GET /:wfid`.
        const wire: readonly WorkflowHeader[] = list.map((wf) =>
          projectWorkflowHeader(wf, undefined, awaitingMap.get(wf.id) ?? 0),
        );
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.list",
          policy: workflowsErrorPolicy,
        });
      }
    },
  );

  // ── POST / — seed a workflow + its initial coord ─────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["workflows"],
      summary: "Create a workflow",
      request: { body: jsonRequest(CreateWorkflowRequestSchema) },
      responses: {
        201: jsonResponse(WorkflowHeaderSchema, "Created workflow"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Coordinator agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const created = unwrapWorkflow(
          await resolve(c).createWorkflow.execute({
            brief: body.brief,
            coordinatorAgent: body.coordinatorAgent,
            ...(body.details !== undefined ? { details: body.details } : {}),
          }),
        );
        const { workflowId } = created;
        // A freshly seeded workflow has exactly one coord node, so
        // `iterationCount` is 1 (silent-retry coords are counted too —
        // a retry IS another iteration). Hard-coded rather than
        // rederived to avoid a second query on the happy path.
        const wf = unwrapWorkflow(await resolve(c).getWorkflow.execute({ workflowId }));
        logEvent(c, "workflow.create", {
          workflowId,
          coordinatorAgent: body.coordinatorAgent,
        });
        return c.json(projectWorkflowHeader(wf, 1, 0), 201);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.create",
          policy: workflowsErrorPolicy,
        });
      }
    },
  );

  // ── GET /:wfid — header only (with iterationCount) ───────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}",
      tags: ["workflows"],
      summary: "Get a workflow header",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(WorkflowHeaderSchema, "Workflow header"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const dag = unwrapWorkflow(
          await resolve(c).getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        const iter = iterationCountForNodes(dag.nodes);
        const awaiting = countAwaitingHuman(dag.nodes);
        return c.json(projectWorkflowHeader(dag.workflow, iter, awaiting));
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.get",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── GET /:wfid/dag — full snapshot (with taskId enrichment) ──────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/dag",
      tags: ["workflows"],
      summary: "Get the full DAG snapshot",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(WorkflowDagSchema, "DAG snapshot"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const snapshot = unwrapWorkflow(
          await resolve(c).getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        const wire: WorkflowDag = await projectWorkflowDag(snapshot, {
          tasks: resolveTasks(c),
        });
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.dag",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── GET /:wfid/nodes/:nid — single node, taskId enriched ─────────
  // Sibling of the dag route, addressable without paying for the
  // full snapshot. Same wire shape as the per-node entries inside
  // `/:wfid/dag.nodes`.
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/nodes/{nid}",
      tags: ["workflows"],
      summary: "Get a single workflow node",
      request: { params: z.object({ wfid: z.string(), nid: z.string() }) },
      responses: {
        200: jsonResponse(WorkflowNodeSchema, "Workflow node"),
        404: errorResponse("Workflow or node not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        const node = unwrapWorkflow(
          await resolve(c).getNode.execute({ nodeId: nid as WorkflowNodeId }),
        );
        // The substrate's `getNode(nid)` is workflow-agnostic by id;
        // re-check the path's `wfid` segment here so a typo'd
        // workflow id doesn't silently return the right node from a
        // different workflow.
        if (node.workflowId !== wfid) {
          throw {
            type: "WorkflowNodeNotFound",
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
          };
        }
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.getNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
        });
      }
    },
  );

  // ── POST /:wfid/cancel — external cancel ─────────────────────────
  // Body shape: `{ cancellation: { kind?: 'user', message } }`.
  // The substrate's `cancelWorkflow` returns void; the route does a
  // second `getDag` so the response carries the post-cancel header.
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/cancel",
      tags: ["workflows"],
      summary: "Cancel a workflow",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(CancelWorkflowRequestSchema),
      },
      responses: {
        200: jsonResponse(WorkflowHeaderSchema, "Updated workflow header"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      const { cancellation } = body;
      try {
        unwrapWorkflow(
          await resolve(c).cancelWorkflow.execute({
            workflowId: wfid as WorkflowId,
            cancellation: { kind: cancellation.kind, message: cancellation.message },
          }),
        );
        const dag = unwrapWorkflow(
          await resolve(c).getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        const iter = iterationCountForNodes(dag.nodes);
        logEvent(c, "workflow.cancel", { workflowId: wfid as WorkflowId });
        return c.json(projectWorkflowHeader(dag.workflow, iter, countAwaitingHuman(dag.nodes)));
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.cancel",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // Artifact read surface (list + per-artifact byte stream). The two
  // handlers live in ./workflows/_artifacts.js; they are registered
  // here so this file stays the single Hono registration surface.
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/artifacts",
      tags: ["workflows"],
      summary: "List workflow artifacts",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(WorkflowArtifactsResponseSchema, "Artifacts"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
      },
    }),
    (c) => handleListArtifacts(c, c.req.param("wfid"), artifactDeps),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/artifacts/{encodedPath}",
      tags: ["workflows"],
      summary: "Stream a single workflow artifact",
      request: { params: z.object({ wfid: z.string(), encodedPath: z.string() }) },
      responses: {
        200: errorResponse("Artifact bytes"),
        400: errorResponse("Malformed artifact path"),
        404: errorResponse("Artifact not found"),
        500: errorResponse("Internal error"),
      },
    }),
    (c) => handleStreamArtifact(c, c.req.param("wfid"), c.req.param("encodedPath"), artifactDeps),
  );

  // ─────────────────────────────────────────────────────────────────
  // Coord-callback mutation surface. Eight routes that expose
  // every primitive on `WorkflowService` except `cancelWorkflow`
  // (which is the operator-only route above). Auth is substrate-
  // derived; handlers forward `workflowId` only.
  // ─────────────────────────────────────────────────────────────────

  // ── POST /:wfid/nodes — addNode ──────────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/nodes",
      tags: ["workflows"],
      summary: "Add a node",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(AddNodeRequestSchema),
      },
      responses: {
        200: jsonResponse(AddNodeResponseSchema, "Inserted node"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).addNode.execute({
            workflowId: wfid as WorkflowId,
            kind: body.kind,
            spec: body.spec,
            parents: body.parents as unknown as readonly WorkflowNodeId[],
          }),
        );
        logEvent(c, "workflow.addNode", {
          workflowId: wfid as WorkflowId,
          nodeId: result.nodeId,
          kind: body.kind,
        });
        return c.json(result);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.addNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── POST /:wfid/edges — addEdge ──────────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/edges",
      tags: ["workflows"],
      summary: "Add an edge",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(AddEdgeRequestSchema),
      },
      responses: {
        200: jsonResponse(AddEdgeResponseSchema, "Inserted edge"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).addEdge.execute({
            workflowId: wfid as WorkflowId,
            fromNodeId: body.fromNodeId as WorkflowNodeId,
            toNodeId: body.toNodeId as WorkflowNodeId,
          }),
        );
        // The substrate returns `{ toPhase }` because inserting an edge
        // can shift the receiving node's phase. The wire echoes the
        // (from, to) pair plus the post-insert phase so the caller has
        // a self-contained record without re-fetching the DAG.
        logEvent(c, "workflow.addEdge", {
          workflowId: wfid as WorkflowId,
          fromNodeId: body.fromNodeId as WorkflowNodeId,
          toNodeId: body.toNodeId as WorkflowNodeId,
          toPhase: result.toPhase,
        });
        return c.json({
          fromNodeId: body.fromNodeId as WorkflowNodeId,
          toNodeId: body.toNodeId as WorkflowNodeId,
          toPhase: result.toPhase,
        });
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.addEdge",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── POST /:wfid/subgraph — addSubgraph ───────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/subgraph",
      tags: ["workflows"],
      summary: "Add a subgraph batch",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(AddSubgraphRequestSchema),
      },
      responses: {
        200: jsonResponse(AddSubgraphResponseSchema, "Inserted nodes"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).addSubgraph.execute({
            workflowId: wfid as WorkflowId,
            nodes: body.nodes.map((n) => ({
              tempId: n.tempId,
              kind: n.kind,
              spec: n.spec,
              ...(n.existingParents !== undefined
                ? { existingParents: n.existingParents as unknown as readonly WorkflowNodeId[] }
                : {}),
            })),
            edges: body.edges.map((e) => ({
              from: resolveNodeRef(e.from),
              to: resolveNodeRef(e.to),
            })),
          }),
        );
        logEvent(c, "workflow.addSubgraph", {
          workflowId: wfid as WorkflowId,
          insertedCount: result.insertedNodes.length,
        });
        return c.json({ insertedNodes: result.insertedNodes });
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.addSubgraph",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── POST /:wfid/nodes/:nid/cancel — cancelNode ───────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/nodes/{nid}/cancel",
      tags: ["workflows"],
      summary: "Cancel a worker node",
      request: { params: z.object({ wfid: z.string(), nid: z.string() }) },
      responses: {
        200: jsonResponse(WorkflowNodeSchema, "Cancelled node"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Node not mutable"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        unwrapWorkflow(
          await resolve(c).cancelNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
          }),
        );
        // Substrate's `cancelNode` returns void; project the post-cancel
        // node so the caller observes the new `status` / `endedAt`
        // without a second round-trip. Enrich with `taskId` for parity
        // with the `/dag` projection.
        const node = unwrapWorkflow(
          await resolve(c).getNode.execute({ nodeId: nid as WorkflowNodeId }),
        );
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.cancelNode", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.cancelNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
        });
      }
    },
  );

  // ── POST /:wfid/finish — finishWorkflow ──────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/finish",
      tags: ["workflows"],
      summary: "Finish a workflow",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(FinishWorkflowRequestSchema),
      },
      responses: {
        200: jsonResponse(WorkflowHeaderSchema, "Updated workflow header"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        if (body.kind === "succeeded") {
          unwrapWorkflow(
            await resolve(c).finishWorkflow.execute({
              workflowId: wfid as WorkflowId,
              outcome: "succeeded",
              success: { output: body.success?.output ?? null },
            }),
          );
        } else {
          unwrapWorkflow(
            await resolve(c).finishWorkflow.execute({
              workflowId: wfid as WorkflowId,
              outcome: "failed",
              failure: { kind: "coordinator", message: body.failure.message },
            }),
          );
        }
        const dag = unwrapWorkflow(
          await resolve(c).getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        const iter = iterationCountForNodes(dag.nodes);
        logEvent(c, "workflow.finish", { workflowId: wfid as WorkflowId, kind: body.kind });
        return c.json(projectWorkflowHeader(dag.workflow, iter, countAwaitingHuman(dag.nodes)));
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.finish",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── DELETE /:wfid/nodes/:nid — removeNode ────────────────────────
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{wfid}/nodes/{nid}",
      tags: ["workflows"],
      summary: "Delete a node",
      request: { params: z.object({ wfid: z.string(), nid: z.string() }) },
      responses: {
        204: errorResponse("Node deleted"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Node not mutable"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        unwrapWorkflow(
          await resolve(c).removeNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
          }),
        );
        logEvent(c, "workflow.removeNode", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.body(null, 204);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.removeNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
        });
      }
    },
  );

  // ── DELETE /:wfid/edges/:from/:to — removeEdge ───────────────────
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{wfid}/edges/{from}/{to}",
      tags: ["workflows"],
      summary: "Delete an edge",
      request: { params: z.object({ wfid: z.string(), from: z.string(), to: z.string() }) },
      responses: {
        204: errorResponse("Edge deleted"),
        404: errorResponse("Workflow or edge not found"),
        409: errorResponse("Edge not mutable"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const from = c.req.param("from");
      const to = c.req.param("to");
      try {
        unwrapWorkflow(
          await resolve(c).removeEdge.execute({
            workflowId: wfid as WorkflowId,
            fromNodeId: from as WorkflowNodeId,
            toNodeId: to as WorkflowNodeId,
          }),
        );
        logEvent(c, "workflow.removeEdge", {
          workflowId: wfid as WorkflowId,
          fromNodeId: from as WorkflowNodeId,
          toNodeId: to as WorkflowNodeId,
        });
        return c.body(null, 204);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.removeEdge",
          policy: workflowsErrorPolicy,
          meta: {
            workflowId: wfid as WorkflowId,
            fromNodeId: from as WorkflowNodeId,
            toNodeId: to as WorkflowNodeId,
          },
        });
      }
    },
  );

  // ── DELETE /:wfid — deleteWorkflow ───────────────────────────────
  //
  // Workflow-level delete with two modes (mirrors `tasks.delete`):
  //   - default (`?purge` absent or not "1") — archive: substrate DB
  //     rows for the workflow + its nodes + edges go; on-disk shared
  //     workflow dir and per-node task workdirs / runtime state are
  //     preserved so the operator can still read the run after the
  //     fact.
  //   - `?purge=1` — hard delete: archive + per-node task purge
  //     (runtime state + task workdirs) + shared workflow dir.
  //
  // Lifecycle constraint: the workflow must be terminal. A running
  // workflow yields 409 `WorkflowDeleteRequiresTerminalError` with
  // a typed body so the dashboard can render the "Cancel first" CTA
  // (mirrors task's `transition: 'delete'` envelope).
  //
  // Cross-substrate composition order:
  //   1. Pre-scan every node for in-flight (non-terminal) tasks via
  //      the `hasInFlightByOrigin` reverse-lookup. If any are
  //      non-terminal, reject the whole operation with a 409 BEFORE
  //      any destructive write — the cascade is all-or-nothing.
  //      Without this gate, a workflow that has just transitioned to
  //      `succeeded` (via `WorkflowService.finishWorkflow`, which
  //      intentionally does not await the coordinator task's exit;
  //      see the `excludeRunningCoords: true` branch) would pass the
  //      `wf.status === "running"` check, partially delete its other
  //      node tasks, then fail with `InvalidTransition` when the
  //      cascade reaches the still-mid-exit coord task — leaving an
  //      undeletable workflow row with half its tasks already purged.
  //   2. Iterate every node's owning task via the task reverse-lookup
  //      and call `tasks.delete(taskId, { purge })`. After the
  //      pre-scan above this should never see a non-terminal task,
  //      but the `InvalidTransition` customBody branch is kept as
  //      defense-in-depth against a tight TOCTOU race.
  //   3. Drop the workflow substrate's own rows + (if purging) shared
  //      dir via `WorkflowService.deleteWorkflow`.
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{wfid}",
      tags: ["workflows"],
      summary: "Delete a workflow",
      request: {
        params: z.object({ wfid: z.string() }),
        query: z.object({ purge: z.literal("1").optional() }),
      },
      responses: {
        204: errorResponse("Workflow deleted"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow not terminal or has in-flight tasks"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const purge = c.req.query("purge") === "1";
      try {
        const wf = resolve(c);
        const tasks = resolveTasks(c);
        // Pre-resolve the snapshot BEFORE touching task rows so a
        // running workflow short-circuits without partial task cleanup.
        // The substrate's `deleteWorkflow` re-checks status inside its
        // tx as defense-in-depth against a race with concurrent
        // cancel-in-flight.
        const snapshot = unwrapWorkflow(
          await wf.getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        if (snapshot.workflow.status === "running") {
          throw {
            type: "WorkflowDeleteRequiresTerminal",
            workflowId: wfid as WorkflowId,
            status: snapshot.workflow.status,
          };
        }
        // All-or-nothing pre-scan for in-flight node tasks (see method
        // doc above for the post-finishWorkflow coord-task race this
        // closes). `hasInFlightByOrigin` is a cheap index-eligible
        // probe; doing N of them is acceptable for typical workflow
        // sizes (< 20 nodes).
        const holdoutNodeIds: string[] = [];
        for (const node of snapshot.nodes) {
          const inFlight = await tasks.hasInFlightByOrigin.execute({
            origin: "workflow",
            originId: node.id,
          });
          if (inFlight.isErr()) {
            throw new TaskOperationError(inFlight.error);
          }
          if (inFlight.value) {
            holdoutNodeIds.push(node.id);
          }
        }
        if (holdoutNodeIds.length > 0) {
          const plural = holdoutNodeIds.length === 1 ? "" : "s";
          return c.json(
            {
              error:
                `workflow ${wfid} has ${holdoutNodeIds.length} in-flight ` +
                `node task${plural}; cancel the workflow first or wait for ` +
                `task${plural} to finish (holdout node id${plural}: ` +
                `${holdoutNodeIds.join(", ")})`,
              code: "WorkflowDeleteHasInFlightTasks",
              transition: "delete",
              holdoutNodeIds,
            },
            409,
          );
        }
        for (const node of snapshot.nodes) {
          const found = await tasks.findLatestByOrigin.execute({
            origin: "workflow",
            originId: node.id,
          });
          if (found.isErr()) {
            throw new TaskOperationError(found.error);
          }
          const linked = found.value;
          if (linked === null) continue;
          const deleted = await tasks.deleteTask.execute({ id: linked.id, purge });
          if (deleted.isErr()) {
            throw new TaskOperationError(deleted.error);
          }
        }
        unwrapWorkflow(
          await wf.deleteWorkflow.execute({ workflowId: wfid as WorkflowId, purgeDir: purge }),
        );
        logEvent(c, "workflow deleted", { workflowId: wfid as WorkflowId, purge });
        return c.body(null, 204);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.delete",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, purge },
          customBody: workflowCustomDeleteBody,
        });
      }
    },
  );

  // ── PATCH /:wfid/nodes/:nid/spec — replaceNodeSpec ───────────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{wfid}/nodes/{nid}/spec",
      tags: ["workflows"],
      summary: "Replace a node's spec",
      request: {
        params: z.object({ wfid: z.string(), nid: z.string() }),
        body: jsonRequest(ReplaceNodeSpecRequestSchema),
      },
      responses: {
        200: jsonResponse(WorkflowNodeSchema, "Updated node"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Node not mutable"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const body = c.req.valid("json");
      try {
        unwrapWorkflow(
          await resolve(c).replaceNodeSpec.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
            newSpec: body.newSpec,
          }),
        );
        // Substrate returns void; project the post-update node so the
        // caller sees the normalized spec (the per-kind runner may have
        // dropped unknown keys or trimmed whitespace at validate time).
        // Enrich with `taskId` for parity with the `/dag` projection.
        const node = unwrapWorkflow(
          await resolve(c).getNode.execute({ nodeId: nid as WorkflowNodeId }),
        );
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.replaceNodeSpec", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.replaceNodeSpec",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
        });
      }
    },
  );

  // ── POST /:wfid/nodes/:nid/respond — human node respond ──────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/nodes/{nid}/respond",
      tags: ["workflows"],
      summary: "Respond to a human node",
      request: {
        params: z.object({ wfid: z.string(), nid: z.string() }),
        body: jsonRequest(RespondHumanNodeRequestSchema),
      },
      responses: {
        200: jsonResponse(WorkflowNodeSchema, "Updated node"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Node not awaiting input"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const body = c.req.valid("json");
      const response: RespondHumanNodeRequest = {
        ...(body.choiceId !== undefined ? { choiceId: body.choiceId } : {}),
        ...(body.input !== undefined ? { input: body.input } : {}),
      };
      try {
        const node = unwrapWorkflow(
          await resolve(c).respondHumanNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
            response,
          }),
        );
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.respondHumanNode", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.json(wire);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.respondHumanNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
        });
      }
    },
  );

  return app;
}

// Re-export the wire-shape type so `index.ts` doesn't have to thread
// it from `@glyphs-ai/api` separately. Matches the schedules
// route pattern.
export type { WorkflowStatus };
