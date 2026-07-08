/**
 * Routes for `/api/workspaces/:id/workflows`. Workspace-scoped read
 * + lifecycle + coord-callback mutation surface over `WorkflowModule`,
 * plus dashboard-facing artifact list / static-bytes routes that
 * bridge the substrate's on-disk artifact dirs to the browser.
 *
 * The substrate is kind-agnostic and stores nodes opaquely as
 * `{ kind, spec: unknown }`; read routes return the workflow package's
 * read-model shapes directly.
 *
 * Resolver-injection pattern matches the sibling `routes/tasks.ts` and
 * the `routes/schedules/` route modules: the mount point in
 * `server/src/index.ts` hands
 * in three functions that pull the workspace-scoped services and the
 * workspace fs root out of Hono's per-request context. The route
 * file never touches workspace resolution, only the workflow + tasks
 * surfaces and the resolved `workspaceDir`.
 *
 * ## Endpoints
 *
 *   - `GET    /`                          — list workflows; `?q=`, `?coordinatorAgent=`, `?createdSince=` narrow
 *   - `POST   /`                          — seed a workflow + its initial coord
 *   - `GET    /:wfid`                     — header only
 *   - `DELETE /:wfid`                     — delete a terminal workflow (`?purge=1` for hard delete)
 *   - `GET    /:wfid/dag`                 — full snapshot (header + nodes + edges)
 *   - `GET    /:wfid/nodes/:nid`          - single node without the full dag
 *   - `POST   /:wfid/cancel`              — external cancel; returns updated header
 *   - `GET    /:wfid/artifacts`           — list workflow-summary + per-node artifacts
 *   - `GET    /:wfid/artifacts/:encoded`  — static bytes for one artifact
 *   - `POST   /:wfid/subgraph`            — batch insert N nodes + M edges
 *   - `POST   /:wfid/prune`               — batch retract N not-started nodes + adjacent edges
 *   - `POST   /:wfid/nodes/:nid/cancel`   — cancel a worker-kind node
 *   - `PATCH  /:wfid/nodes/:nid/spec`     — patch a not-started worker/human node's spec
 *   - `POST   /:wfid/nodes/:nid/respond`  - answer a waiting human-kind node
 *   - `POST   /:wfid/finish`              — flip workflow terminal
 *
 * ## Workflow lifecycle gate (mutation routes)
 *
 * Every mutation route forwards `workflowId` from the URL path and
 * NOTHING ELSE about the caller. The substrate re-checks the workflow's
 * lifecycle status inside its mutation tx and rejects mutations against
 * a terminal workflow with `WorkflowAlreadyTerminal` → 409 from the
 * policy below.
 *
 * ## Cancel response
 *
 * `cancelWorkflow` returns `Promise<void>`; the route does a second
 * `getWorkflow` after the cancel to return the post-cancel header (so
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

import { stat } from "node:fs/promises";
import path from "node:path";
import type { TaskModule } from "@glyphs-ai/task";
import type {
  WorkflowArtifactRef,
  WorkflowId,
  WorkflowModule,
  WorkflowNodeId,
} from "@glyphs-ai/workflow";
import {
  AddWorkflowSubgraphRequestSchema,
  AddWorkflowSubgraphResponseSchema,
  GetWorkflowDagResponseSchema,
  GetWorkflowNodeResponseSchema,
  GetWorkflowResponseSchema,
  ListWorkflowArtifactsResponseSchema,
  ListWorkflowsResponseSchema,
  PruneWorkflowSubgraphRequestSchema,
  PruneWorkflowSubgraphResponseSchema,
  UpdateWorkflowNodeSpecRequestSchema,
  UpdateWorkflowNodeSpecResponseSchema,
  CancelWorkflowRequestSchema as WorkflowCancelWorkflowRequestSchema,
  CreateWorkflowRequestSchema as WorkflowCreateWorkflowRequestSchema,
  FinishWorkflowRequestSchema as WorkflowFinishWorkflowRequestSchema,
  RespondToHumanNodeRequestSchema as WorkflowRespondToHumanNodeRequestSchema,
} from "@glyphs-ai/workflow";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Result } from "neverthrow";
import {
  respondWorkflowError,
  type WorkflowRouteError,
  workflowsErrorPolicy,
} from "../_error-policies/workflows.js";
import { logEvent, problemResponse, respondError } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import { contentTypeFor, streamFileAsResponse } from "./_artifact-stream.js";

type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowModule;
type WorkflowTasksResolver = (c: import("hono").Context) => TaskModule;
type WorkflowWorkspaceDirResolver = (c: import("hono").Context) => string;

const [finishSucceededRequestSchema, finishFailedRequestSchema] =
  WorkflowFinishWorkflowRequestSchema.options;
const FinishWorkflowRequestBodySchema = z.discriminatedUnion("outcome", [
  finishSucceededRequestSchema.omit({ workflowId: true }),
  finishFailedRequestSchema.omit({ workflowId: true }),
]);

function unwrapWorkflow<T, E extends WorkflowRouteError>(result: Result<T, E>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}

function respondArtifactError(
  c: Context,
  err: { readonly type: string; readonly cause?: unknown },
  route: string,
  meta: Record<string, unknown>,
): Response {
  if (err.type === "WorkflowNotFound") {
    return respondWorkflowError(c, err, { route, policy: workflowsErrorPolicy, meta });
  }
  return respondError(c, err.cause ?? err, {
    route,
    policy: workflowsErrorPolicy,
    meta,
    defaultStatus: 500,
  });
}

export function workflowsRoutes(
  resolve: WorkflowServiceResolver,
  resolveTasks: WorkflowTasksResolver,
  _resolveWorkspaceDir: WorkflowWorkspaceDirResolver,
): OpenAPIHono {
  const app = createApiApp();

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
        200: jsonResponse(ListWorkflowsResponseSchema, "Workflows"),
        400: errorResponse("Malformed query"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      // `createdSince` is forwarded verbatim into a SQL `>=` predicate on the
      // text-sortable `created_at` column, so any `Date.parse`-able ISO 8601
      // shape works — reject only obviously malformed input at the boundary.
      const createdSince = c.req.query("createdSince");
      if (createdSince !== undefined && Number.isNaN(Date.parse(createdSince))) {
        return problemResponse(c, 400, {
          code: "WorkflowError",
          detail: "createdSince must be an ISO 8601 timestamp",
        });
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
      if (createdSince !== undefined) opts.createdSince = createdSince;
      try {
        const list = unwrapWorkflow(await resolve(c).listWorkflows.execute(opts));
        return c.json(list);
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
      request: {
        body: jsonRequest(
          WorkflowCreateWorkflowRequestSchema.omit({
            origin: true,
            originId: true,
            metadata: true,
          }).strict(),
        ),
      },
      responses: {
        201: jsonResponse(GetWorkflowResponseSchema, "Created workflow"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Coordinator agent not found"),
        409: errorResponse("Workflow state conflict"),
        422: errorResponse("Unprocessable entity"),
        500: errorResponse("Internal error"),
        501: errorResponse("Runtime does not support tasks"),
        503: errorResponse("Service unavailable"),
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
        const wf = unwrapWorkflow(await resolve(c).getWorkflow.execute({ workflowId }));
        logEvent(c, "workflow.create", {
          workflowId,
          coordinatorAgent: body.coordinatorAgent,
        });
        return c.json(wf, 201);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.create",
          policy: workflowsErrorPolicy,
        });
      }
    },
  );

  // ── GET /:wfid — header only ─────────────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}",
      tags: ["workflows"],
      summary: "Get a workflow header",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(GetWorkflowResponseSchema, "Workflow header"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const wf = unwrapWorkflow(
          await resolve(c).getWorkflow.execute({ workflowId: wfid as WorkflowId }),
        );
        return c.json(wf);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.get",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── GET /:wfid/dag — full snapshot ───────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/dag",
      tags: ["workflows"],
      summary: "Get the full DAG snapshot",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(GetWorkflowDagResponseSchema, "DAG snapshot"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const snapshot = unwrapWorkflow(
          await resolve(c).getDag.execute({ workflowId: wfid as WorkflowId }),
        );
        return c.json(snapshot);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.dag",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── GET /:wfid/nodes/:nid — single node ──────────────────────────
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
        200: jsonResponse(GetWorkflowNodeResponseSchema, "Workflow node"),
        404: errorResponse("Workflow or node not found"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        const node = unwrapWorkflow(
          await resolve(c).getNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
          }),
        );
        return c.json(node);
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
  // second `getWorkflow` so the response carries the post-cancel header.
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/cancel",
      tags: ["workflows"],
      summary: "Cancel a workflow",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(WorkflowCancelWorkflowRequestSchema.omit({ workflowId: true }).strict()),
      },
      responses: {
        200: jsonResponse(GetWorkflowResponseSchema, "Updated workflow header"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
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
            cancellation,
          }),
        );
        const wf = unwrapWorkflow(
          await resolve(c).getWorkflow.execute({ workflowId: wfid as WorkflowId }),
        );
        logEvent(c, "workflow.cancel", { workflowId: wfid as WorkflowId });
        return c.json(wf);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.cancel",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // Artifact read surface (list + per-artifact byte stream).
  app.openapi(
    createRoute({
      method: "get",
      path: "/{wfid}/artifacts",
      tags: ["workflows"],
      summary: "List workflow artifacts",
      request: { params: z.object({ wfid: z.string() }) },
      responses: {
        200: jsonResponse(ListWorkflowArtifactsResponseSchema, "Artifacts"),
        404: errorResponse("Workflow not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const result = await resolve(c).listWorkflowArtifacts.execute({
        workflowId: wfid as WorkflowId,
      });
      if (result.isErr()) {
        return respondArtifactError(c, result.error, "workflows.artifacts.list", {
          workflowId: wfid as WorkflowId,
        });
      }
      // The workflow module owns the artifact listing shape; forward it as-is.
      return c.json(result.value);
    },
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
    async (c) => {
      const wfid = c.req.param("wfid");
      const encoded = c.req.param("encodedPath");
      let decoded: string;
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        return problemResponse(c, 400, {
          code: "BadRequest",
          detail: "encodedPath is not a valid percent-encoded string",
        });
      }

      if (decoded.includes("..") || decoded.includes("\0")) {
        return problemResponse(c, 400, {
          code: "BadRequest",
          detail: "traversal segment in artifact path",
        });
      }

      let ref: WorkflowArtifactRef;
      let cacheControl: string;

      if (decoded.startsWith("summary/")) {
        const rest = decoded.slice("summary/".length);
        if (rest === "" || rest.startsWith("/")) {
          return problemResponse(c, 400, {
            code: "BadRequest",
            detail: "summary path missing trailing segments",
          });
        }
        ref = { kind: "summary", relPath: rest };
        cacheControl = "no-store";
      } else if (decoded.startsWith("nodes/")) {
        const tail = decoded.slice("nodes/".length);
        const sep = tail.indexOf("/");
        if (sep <= 0 || sep === tail.length - 1) {
          return problemResponse(c, 400, {
            code: "BadRequest",
            detail: "nodes path must be nodes/<nodeId>/<rest>",
          });
        }
        ref = {
          kind: "node",
          nodeId: tail.slice(0, sep) as WorkflowNodeId,
          relPath: tail.slice(sep + 1),
        };
        cacheControl = "max-age=300";
      } else {
        return problemResponse(c, 400, {
          code: "BadRequest",
          detail: "artifact path must start with summary/ or nodes/<nid>/",
        });
      }

      const result = await resolve(c).resolveWorkflowArtifactPath.execute({
        workflowId: wfid as WorkflowId,
        ref,
      });
      if (result.isErr()) {
        return respondArtifactError(c, result.error, "workflows.artifacts.stream", {
          workflowId: wfid as WorkflowId,
          ...(ref.kind === "node" ? { nodeId: ref.nodeId } : {}),
        });
      }

      const absPath = result.value;
      if (absPath === null) {
        return problemResponse(c, 404, {
          code: "NotFound",
          detail: ref.kind === "node" ? "no such node in workflow" : "artifact not found",
        });
      }

      try {
        const st = await stat(absPath);
        if (!st.isFile()) {
          return problemResponse(c, 404, { code: "NotFound", detail: "artifact not found" });
        }
      } catch {
        return problemResponse(c, 404, { code: "NotFound", detail: "artifact not found" });
      }

      return streamFileAsResponse(absPath, {
        contentType: contentTypeFor(path.basename(absPath)),
        cacheControl,
      });
    },
  );

  // ─────────────────────────────────────────────────────────────────
  // Coord-callback mutation surface. Auth is substrate-derived;
  // handlers forward `workflowId` only.
  // ─────────────────────────────────────────────────────────────────

  // ── POST /:wfid/subgraph — addSubgraph ───────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/subgraph",
      tags: ["workflows"],
      summary: "Add a subgraph batch",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(AddWorkflowSubgraphRequestSchema.omit({ workflowId: true })),
      },
      responses: {
        200: jsonResponse(AddWorkflowSubgraphResponseSchema, "Inserted nodes"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        422: errorResponse("Unprocessable entity"),
        500: errorResponse("Internal error"),
        501: errorResponse("Runtime does not support tasks"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).addSubgraph.execute({
            workflowId: wfid as WorkflowId,
            nodes: body.nodes,
            edges: body.edges,
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

  // ── POST /:wfid/prune — pruneSubgraph ────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{wfid}/prune",
      tags: ["workflows"],
      summary: "Prune a batch of not-started nodes",
      request: {
        params: z.object({ wfid: z.string() }),
        body: jsonRequest(PruneWorkflowSubgraphRequestSchema.omit({ workflowId: true })),
      },
      responses: {
        200: jsonResponse(PruneWorkflowSubgraphResponseSchema, "Pruned nodes and edges"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        422: errorResponse("Unprocessable entity"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).pruneSubgraph.execute({
            workflowId: wfid as WorkflowId,
            nodeIds: body.nodeIds,
          }),
        );
        logEvent(c, "workflow.pruneSubgraph", {
          workflowId: wfid as WorkflowId,
          prunedCount: result.prunedNodeIds.length,
        });
        return c.json({ prunedNodeIds: result.prunedNodeIds, prunedEdges: result.prunedEdges });
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.pruneSubgraph",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
        });
      }
    },
  );

  // ── PATCH /:wfid/nodes/:nid/spec — updateNodeSpec ────────────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{wfid}/nodes/{nid}/spec",
      tags: ["workflows"],
      summary: "Patch a not-started node's spec",
      request: {
        params: z.object({ wfid: z.string(), nid: z.string() }),
        body: jsonRequest(
          UpdateWorkflowNodeSpecRequestSchema.omit({ workflowId: true, nodeId: true }),
        ),
      },
      responses: {
        200: jsonResponse(UpdateWorkflowNodeSpecResponseSchema, "Patched node"),
        400: errorResponse("Malformed request body, node kind mismatch, or coordinator target"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Workflow terminal or node not mutable"),
        422: errorResponse("Merged node spec invalid"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const body = c.req.valid("json");
      try {
        const result = unwrapWorkflow(
          await resolve(c).updateNodeSpec.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
            target: body.target,
          }),
        );
        logEvent(c, "workflow.updateNodeSpec", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
          kind: body.target.kind,
        });
        return c.json(result);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.updateNodeSpec",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId, nodeId: nid as WorkflowNodeId },
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
        200: jsonResponse(GetWorkflowNodeResponseSchema, "Cancelled node"),
        404: errorResponse("Workflow or node not found"),
        409: errorResponse("Node not mutable"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
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
        const node = unwrapWorkflow(
          await resolve(c).getNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
          }),
        );
        logEvent(c, "workflow.cancelNode", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.json(node);
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
        body: jsonRequest(FinishWorkflowRequestBodySchema),
      },
      responses: {
        200: jsonResponse(GetWorkflowResponseSchema, "Updated workflow header"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow not found"),
        409: errorResponse("Workflow already terminal"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const body = c.req.valid("json");
      try {
        unwrapWorkflow(
          await resolve(c).finishWorkflow.execute({
            workflowId: wfid as WorkflowId,
            ...body,
          }),
        );
        const wf = unwrapWorkflow(
          await resolve(c).getWorkflow.execute({ workflowId: wfid as WorkflowId }),
        );
        logEvent(c, "workflow.finish", { workflowId: wfid as WorkflowId, outcome: body.outcome });
        return c.json(wf);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "workflows.finish",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid as WorkflowId },
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
  // workflow yields 409 `WorkflowDeleteRequiresTerminal` with
  // a typed body so the dashboard can render the "Cancel first" CTA
  // (mirrors task's `transition: 'delete'` envelope).
  //
  // Cross-substrate composition order:
  //   1. Pre-scan every node for in-flight (non-terminal) tasks via
  //      the `hasInFlightByOrigin` reverse-lookup. If any are
  //      non-terminal, reject the whole operation with a 409 BEFORE
  //      any destructive write — the cascade is all-or-nothing.
  //      Without this gate, a workflow that has just transitioned to
  //      `succeeded` (via `WorkflowModule.finishWorkflow`, which
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
  //      dir via `WorkflowModule.deleteWorkflow`.
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
        503: errorResponse("Service unavailable"),
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
            throw inFlight.error;
          }
          if (inFlight.value) {
            holdoutNodeIds.push(node.id);
          }
        }
        if (holdoutNodeIds.length > 0) {
          const plural = holdoutNodeIds.length === 1 ? "" : "s";
          return problemResponse(c, 409, {
            code: "WorkflowDeleteHasInFlightTasks",
            detail:
              `workflow ${wfid} has ${holdoutNodeIds.length} in-flight ` +
              `node task${plural}; cancel the workflow first or wait for ` +
              `task${plural} to finish (holdout node id${plural}: ` +
              `${holdoutNodeIds.join(", ")})`,
            extensions: { transition: "delete", holdoutNodeIds },
          });
        }
        for (const node of snapshot.nodes) {
          const found = await tasks.findLatestByOrigin.execute({
            origin: "workflow",
            originId: node.id,
          });
          if (found.isErr()) {
            throw found.error;
          }
          const linked = found.value;
          if (linked === null) continue;
          const deleted = await tasks.deleteTask.execute({ id: linked.id, purge });
          if (deleted.isErr()) {
            throw deleted.error;
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
          transition: "delete",
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
        body: jsonRequest(
          WorkflowRespondToHumanNodeRequestSchema.omit({ workflowId: true, nodeId: true }),
        ),
      },
      responses: {
        200: jsonResponse(GetWorkflowNodeResponseSchema, "Updated node"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workflow or node not found"),
        422: errorResponse("Unprocessable entity"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const body = c.req.valid("json");
      try {
        const node = unwrapWorkflow(
          await resolve(c).respondHumanNode.execute({
            workflowId: wfid as WorkflowId,
            nodeId: nid as WorkflowNodeId,
            response: body.response,
          }),
        );
        logEvent(c, "workflow.respondHumanNode", {
          workflowId: wfid as WorkflowId,
          nodeId: nid as WorkflowNodeId,
        });
        return c.json(node);
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
