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
  RespondHumanNodeBody,
  WorkflowDagWire,
  WorkflowHeaderWire,
  WorkflowStatusWire,
} from "@glyphs-ai/api";
import { InvalidTransition, type TaskService } from "@glyphs-ai/task";
import {
  WorkflowDeleteRequiresTerminalError,
  WorkflowError,
  WorkflowNodeNotFoundError,
  type WorkflowService,
} from "@glyphs-ai/workflow";
import { Hono } from "hono";
import { workflowsErrorPolicy } from "./_error-policies/workflows.js";
import { defineHandler } from "./_handler.js";
import { respondError } from "./_respond-error.js";
import { errorBody, logEvent, parseJsonBody } from "./_shared.js";
import {
  countAwaitingHuman,
  iterationCountForNodes,
  projectWorkflowDag,
  projectWorkflowHeader,
  projectWorkflowNodeWithTaskId,
} from "./_workflow-projection.js";
import { handleListArtifacts, handleStreamArtifact } from "./workflows/_artifacts.js";
import {
  nodeRefFromWire,
  validateAddEdgeBody,
  validateAddNodeBody,
  validateAddSubgraphBody,
  validateCancelWorkflowBody,
  validateCreateBody,
  validateCreatedSinceQuery,
  validateFinishWorkflowBody,
  validateReplaceNodeSpecBody,
} from "./workflows/_validators.js";

type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowService;
type WorkflowTasksResolver = (c: import("hono").Context) => TaskService;
type WorkflowWorkspaceDirResolver = (c: import("hono").Context) => string;

export function workflowsRoutes(
  resolve: WorkflowServiceResolver,
  resolveTasks: WorkflowTasksResolver,
  resolveWorkspaceDir: WorkflowWorkspaceDirResolver,
): Hono {
  const app = new Hono();
  const artifactDeps = { resolve, resolveTasks, resolveWorkspaceDir };

  // ── GET / — list with optional q / coordinatorAgent / createdSince ─
  app.get(
    "/",
    defineHandler("workflows.list", async (c) => {
      const createdSinceResult = validateCreatedSinceQuery(c.req.query("createdSince"));
      if (!createdSinceResult.ok) {
        return c.json(errorBody(new WorkflowError(createdSinceResult.error)), 400);
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
        const [list, awaitingMap] = await Promise.all([
          resolve(c).list(opts),
          resolve(c).countAwaitingHumanByWorkflow(),
        ]);
        // `iterationCount` is omitted from list rows to keep the
        // endpoint O(workflows): computing it per row would require a
        // DAG snapshot per workflow. Clients that need the accurate
        // count fetch the header via `GET /:wfid`.
        const wire: readonly WorkflowHeaderWire[] = list.map((wf) =>
          projectWorkflowHeader(wf, undefined, awaitingMap.get(wf.id) ?? 0),
        );
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.list",
          policy: workflowsErrorPolicy,
        });
      }
    }),
  );

  // ── POST / — seed a workflow + its initial coord ─────────────────
  app.post(
    "/",
    defineHandler(
      "workflows.create",
      async (c) => {
        const parsed = await parseJsonBody(c);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        const validated = validateCreateBody(parsed.body);
        if (!validated.ok) return c.json({ error: validated.error }, 400);
        const body = validated.value;
        try {
          const { workflowId } = await resolve(c).createWorkflow({
            brief: body.brief,
            coordinatorAgent: body.coordinatorAgent,
            ...(body.details !== undefined ? { details: body.details } : {}),
          });
          // A freshly seeded workflow has exactly one coord node, so
          // `iterationCount` is 1 (silent-retry coords are counted too —
          // a retry IS another iteration). Hard-coded rather than
          // rederived to avoid a second query on the happy path.
          const wf = await resolve(c).getWorkflow(workflowId);
          logEvent(c, "workflow.create", {
            workflowId,
            coordinatorAgent: body.coordinatorAgent,
          });
          return projectWorkflowHeader(wf, 1, 0);
        } catch (err) {
          return respondError(c, err, {
            route: "workflows.create",
            policy: workflowsErrorPolicy,
          });
        }
      },
      { status: 201 },
    ),
  );

  // ── GET /:wfid — header only (with iterationCount) ───────────────
  app.get(
    "/:wfid",
    defineHandler("workflows.get", async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const dag = await resolve(c).getDag(wfid);
        const iter = iterationCountForNodes(dag.nodes);
        const awaiting = countAwaitingHuman(dag.nodes);
        return projectWorkflowHeader(dag.workflow, iter, awaiting);
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.get",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── GET /:wfid/dag — full snapshot (with taskId enrichment) ──────
  app.get(
    "/:wfid/dag",
    defineHandler("workflows.dag.get", async (c) => {
      const wfid = c.req.param("wfid");
      try {
        const snapshot = await resolve(c).getDag(wfid);
        const wire: WorkflowDagWire = await projectWorkflowDag(snapshot, {
          tasks: resolveTasks(c),
        });
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.dag",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── GET /:wfid/nodes/:nid — single node, taskId enriched ─────────
  // Sibling of the dag route, addressable without paying for the
  // full snapshot. Same wire shape as the per-node entries inside
  // `/:wfid/dag.nodes`.
  app.get(
    "/:wfid/nodes/:nid",
    defineHandler("workflows.nodes.get", async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        const node = await resolve(c).getNode(nid);
        // The substrate's `getNode(nid)` is workflow-agnostic by id;
        // re-check the path's `wfid` segment here so a typo'd
        // workflow id doesn't silently return the right node from a
        // different workflow.
        if (node.workflowId !== wfid) {
          throw new WorkflowNodeNotFoundError(wfid, nid);
        }
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.getNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, nodeId: nid },
        });
      }
    }),
  );

  // ── POST /:wfid/cancel — external cancel ─────────────────────────
  // Body shape: `{ cancellation: { kind?: 'user', message } }`.
  // The substrate's `cancelWorkflow` returns void; the route does a
  // second `getDag` so the response carries the post-cancel header.
  app.post(
    "/:wfid/cancel",
    defineHandler("workflows.cancel", async (c) => {
      const wfid = c.req.param("wfid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateCancelWorkflowBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const { cancellation } = validated.value;
      try {
        await resolve(c).cancelWorkflow(wfid, {
          cancellation: { kind: cancellation.kind, message: cancellation.message },
        });
        const dag = await resolve(c).getDag(wfid);
        const iter = iterationCountForNodes(dag.nodes);
        logEvent(c, "workflow.cancel", { workflowId: wfid });
        return projectWorkflowHeader(dag.workflow, iter, countAwaitingHuman(dag.nodes));
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.cancel",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // Artifact read surface (list + per-artifact byte stream). The two
  // handlers live in ./workflows/_artifacts.js; they are registered
  // here so this file stays the single Hono registration surface.
  app.get(
    "/:wfid/artifacts",
    defineHandler("workflows.artifacts.list", (c) =>
      handleListArtifacts(c, c.req.param("wfid"), artifactDeps),
    ),
  );
  app.get(
    "/:wfid/artifacts/:encodedPath",
    defineHandler("workflows.artifacts.get", (c) =>
      handleStreamArtifact(c, c.req.param("wfid"), c.req.param("encodedPath"), artifactDeps),
    ),
  );

  // ─────────────────────────────────────────────────────────────────
  // Coord-callback mutation surface. Eight routes that expose
  // every primitive on `WorkflowService` except `cancelWorkflow`
  // (which is the operator-only route above). Auth is substrate-
  // derived; handlers forward `workflowId` only.
  // ─────────────────────────────────────────────────────────────────

  // ── POST /:wfid/nodes — addNode ──────────────────────────────────
  app.post(
    "/:wfid/nodes",
    defineHandler("workflows.nodes.add", async (c) => {
      const wfid = c.req.param("wfid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateAddNodeBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const body = validated.value;
      try {
        const result = await resolve(c).addNode(wfid, {
          kind: body.kind,
          spec: body.spec,
          parents: body.parents,
        });
        logEvent(c, "workflow.addNode", {
          workflowId: wfid,
          nodeId: result.nodeId,
          kind: body.kind,
        });
        return result;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.addNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── POST /:wfid/edges — addEdge ──────────────────────────────────
  app.post(
    "/:wfid/edges",
    defineHandler("workflows.edges.add", async (c) => {
      const wfid = c.req.param("wfid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateAddEdgeBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const body = validated.value;
      try {
        const result = await resolve(c).addEdge(wfid, {
          fromNodeId: body.fromNodeId,
          toNodeId: body.toNodeId,
        });
        // The substrate returns `{ toPhase }` because inserting an edge
        // can shift the receiving node's phase. The wire echoes the
        // (from, to) pair plus the post-insert phase so the caller has
        // a self-contained record without re-fetching the DAG.
        logEvent(c, "workflow.addEdge", {
          workflowId: wfid,
          fromNodeId: body.fromNodeId,
          toNodeId: body.toNodeId,
          toPhase: result.toPhase,
        });
        return {
          fromNodeId: body.fromNodeId,
          toNodeId: body.toNodeId,
          toPhase: result.toPhase,
        };
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.addEdge",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── POST /:wfid/subgraph — addSubgraph ───────────────────────────
  app.post(
    "/:wfid/subgraph",
    defineHandler("workflows.subgraph.add", async (c) => {
      const wfid = c.req.param("wfid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateAddSubgraphBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const body = validated.value;
      try {
        const result = await resolve(c).addSubgraph(wfid, {
          nodes: body.nodes.map((n) => ({
            tempId: n.tempId,
            kind: n.kind,
            spec: n.spec,
            ...(n.existingParents !== undefined ? { existingParents: n.existingParents } : {}),
          })),
          edges: body.edges.map((e) => ({
            from: nodeRefFromWire(e.from),
            to: nodeRefFromWire(e.to),
          })),
        });
        logEvent(c, "workflow.addSubgraph", {
          workflowId: wfid,
          insertedCount: result.insertedNodes.length,
        });
        return { insertedNodes: result.insertedNodes };
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.addSubgraph",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── POST /:wfid/nodes/:nid/cancel — cancelNode ───────────────────
  app.post(
    "/:wfid/nodes/:nid/cancel",
    defineHandler("workflows.nodes.cancel", async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        await resolve(c).cancelNode(wfid, nid);
        // Substrate's `cancelNode` returns void; project the post-cancel
        // node so the caller observes the new `status` / `endedAt`
        // without a second round-trip. Enrich with `taskId` for parity
        // with the `/dag` projection.
        const node = await resolve(c).getNode(nid);
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.cancelNode", { workflowId: wfid, nodeId: nid });
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.cancelNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, nodeId: nid },
        });
      }
    }),
  );

  // ── POST /:wfid/finish — finishWorkflow ──────────────────────────
  app.post(
    "/:wfid/finish",
    defineHandler("workflows.finish", async (c) => {
      const wfid = c.req.param("wfid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateFinishWorkflowBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const body = validated.value;
      try {
        if (body.kind === "succeeded") {
          await resolve(c).finishWorkflow(wfid, {
            outcome: "succeeded",
            success: { output: body.success?.output ?? null },
          });
        } else {
          await resolve(c).finishWorkflow(wfid, {
            outcome: "failed",
            failure: { kind: "coordinator", message: body.failure.message },
          });
        }
        const dag = await resolve(c).getDag(wfid);
        const iter = iterationCountForNodes(dag.nodes);
        logEvent(c, "workflow.finish", { workflowId: wfid, kind: body.kind });
        return projectWorkflowHeader(dag.workflow, iter, countAwaitingHuman(dag.nodes));
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.finish",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid },
        });
      }
    }),
  );

  // ── DELETE /:wfid/nodes/:nid — removeNode ────────────────────────
  app.delete(
    "/:wfid/nodes/:nid",
    defineHandler("workflows.nodes.remove", async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      try {
        await resolve(c).removeNode(wfid, nid);
        logEvent(c, "workflow.removeNode", { workflowId: wfid, nodeId: nid });
        return c.body(null, 204);
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.removeNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, nodeId: nid },
        });
      }
    }),
  );

  // ── DELETE /:wfid/edges/:from/:to — removeEdge ───────────────────
  app.delete(
    "/:wfid/edges/:from/:to",
    defineHandler("workflows.edges.remove", async (c) => {
      const wfid = c.req.param("wfid");
      const from = c.req.param("from");
      const to = c.req.param("to");
      try {
        await resolve(c).removeEdge(wfid, {
          fromNodeId: from,
          toNodeId: to,
        });
        logEvent(c, "workflow.removeEdge", {
          workflowId: wfid,
          fromNodeId: from,
          toNodeId: to,
        });
        return c.body(null, 204);
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.removeEdge",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, fromNodeId: from, toNodeId: to },
        });
      }
    }),
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
  //      the `hasInFlightForWorkflowNode` reverse-lookup. If any are
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
  app.delete(
    "/:wfid",
    defineHandler("workflows.delete", async (c) => {
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
        const snapshot = await wf.getDag(wfid);
        if (snapshot.workflow.status === "running") {
          throw new WorkflowDeleteRequiresTerminalError(wfid, snapshot.workflow.status);
        }
        // All-or-nothing pre-scan for in-flight node tasks (see method
        // doc above for the post-finishWorkflow coord-task race this
        // closes). `hasInFlightForWorkflowNode` is a cheap index-eligible
        // probe; doing N of them is acceptable for typical workflow
        // sizes (< 20 nodes).
        const holdoutNodeIds: string[] = [];
        for (const node of snapshot.nodes) {
          if (await tasks.hasInFlightForWorkflowNode(node.id)) {
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
          const linked = await tasks.findTaskByWorkflowNode(node.id);
          if (linked === null) continue;
          await tasks.delete(linked.id, { purge });
        }
        await wf.deleteWorkflow(wfid, { purgeDir: purge });
        logEvent(c, "workflow deleted", { workflowId: wfid, purge });
        return c.body(null, 204);
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.delete",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, purge },
          customBody: (e) => {
            if (e instanceof WorkflowDeleteRequiresTerminalError) {
              return {
                error: e.message,
                code: e.name,
                status: e.status,
                transition: "delete",
              };
            }
            if (e instanceof InvalidTransition) {
              return {
                error: e.message,
                code: "InvalidTransition",
                status: e.from,
                transition: "delete",
              };
            }
            return null;
          },
        });
      }
    }),
  );

  // ── PATCH /:wfid/nodes/:nid/spec — replaceNodeSpec ───────────────
  app.patch(
    "/:wfid/nodes/:nid/spec",
    defineHandler("workflows.nodes.spec.replace", async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const validated = validateReplaceNodeSpecBody(parsed.body);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const body = validated.value;
      try {
        await resolve(c).replaceSpec(wfid, nid, {
          newSpec: body.newSpec,
        });
        // Substrate returns void; project the post-update node so the
        // caller sees the normalized spec (the per-kind runner may have
        // dropped unknown keys or trimmed whitespace at validate time).
        // Enrich with `taskId` for parity with the `/dag` projection.
        const node = await resolve(c).getNode(nid);
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.replaceNodeSpec", { workflowId: wfid, nodeId: nid });
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.replaceNodeSpec",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, nodeId: nid },
        });
      }
    }),
  );

  // ── POST /:wfid/nodes/:nid/respond — human node respond ──────────
  app.post(
    "/:wfid/nodes/:nid/respond",
    defineHandler("workflows.nodes.respond", async (c) => {
      const wfid = c.req.param("wfid");
      const nid = c.req.param("nid");
      const parsed = await parseJsonBody(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body as Record<string, unknown>;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "request body must be an object" }, 400);
      }
      const { choiceId, input } = body;
      if (choiceId !== undefined && (typeof choiceId !== "string" || choiceId.length === 0)) {
        return c.json({ error: "choiceId, when set, must be a non-empty string" }, 400);
      }
      if (choiceId === undefined) {
        if (typeof input !== "string" || input.trim().length === 0) {
          return c.json({ error: "input is required when choiceId is absent" }, 400);
        }
      }
      if (input !== undefined && typeof input !== "string") {
        return c.json({ error: "input, when set, must be a string" }, 400);
      }
      const response: RespondHumanNodeBody = {
        ...(choiceId !== undefined ? { choiceId } : {}),
        ...(input !== undefined ? { input } : {}),
      };
      try {
        const node = await resolve(c).respondHumanNode(wfid, nid, response);
        const wire = await projectWorkflowNodeWithTaskId(node, { tasks: resolveTasks(c) });
        logEvent(c, "workflow.respondHumanNode", { workflowId: wfid, nodeId: nid });
        return wire;
      } catch (err) {
        return respondError(c, err, {
          route: "workflows.respondHumanNode",
          policy: workflowsErrorPolicy,
          meta: { workflowId: wfid, nodeId: nid },
        });
      }
    }),
  );

  return app;
}

// Re-export the wire-shape type so `index.ts` doesn't have to thread
// it from `@glyphs-ai/contracts` separately. Matches the schedules
// route pattern.
export type { WorkflowStatusWire };
