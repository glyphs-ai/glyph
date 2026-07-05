import type {
  GetApiWorkspacesByIdWorkflowsByWfidArtifactsResponse,
  GetApiWorkspacesByIdWorkflowsByWfidDagResponse,
  GetApiWorkspacesByIdWorkflowsByWfidResponse,
  GetApiWorkspacesByIdWorkflowsData,
  PostApiWorkspacesByIdWorkflowsByWfidCancelData,
  PostApiWorkspacesByIdWorkflowsByWfidCancelResponses,
  PostApiWorkspacesByIdWorkflowsByWfidNodesByNidRespondData,
  PostApiWorkspacesByIdWorkflowsData,
  PostApiWorkspacesByIdWorkflowsResponses,
} from "@glyphs-ai/sdk";
import {
  client,
  deleteApiWorkspacesByIdWorkflowsByWfid,
  getApiWorkspacesByIdWorkflows,
  getApiWorkspacesByIdWorkflowsByWfid,
  getApiWorkspacesByIdWorkflowsByWfidArtifacts,
} from "@glyphs-ai/sdk";
import { fetchJson, jsonInit, mutateJson, workspacePrefix } from "./http.js";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";

// Local type aliases for workflow shapes (previously exported from sdk/wire.ts).
export type WorkflowHeader = GetApiWorkspacesByIdWorkflowsByWfidResponse;
export type WorkflowDag = GetApiWorkspacesByIdWorkflowsByWfidDagResponse;
export type WorkflowNode = WorkflowDag["nodes"][number];
export type WorkflowEdge = WorkflowDag["edges"][number];
export type WorkflowNodeSpec = WorkflowNode["spec"];
export type WorkflowArtifactsResponse = GetApiWorkspacesByIdWorkflowsByWfidArtifactsResponse;
export type WorkflowArtifact = WorkflowArtifactsResponse["artifacts"][number];
export type WorkflowListQuery = NonNullable<GetApiWorkspacesByIdWorkflowsData["query"]>;
export type CreateWorkflowRequest = NonNullable<PostApiWorkspacesByIdWorkflowsData["body"]>;
export type CancelWorkflowRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidCancelData["body"]
>;
export type RespondHumanNodeRequest = NonNullable<
  PostApiWorkspacesByIdWorkflowsByWfidNodesByNidRespondData["body"]
>;

// Concrete spec type for human nodes. WorkflowNode["spec"] is `unknown`
// so Extract<unknown, ...> resolves to never; we declare the shape directly.
export type WorkflowHumanNodeSpec = {
  kind: "human";
  prompt: string;
  promptStyle?: "plain" | "markdown";
  choices?: readonly { id: string; label: string }[];
};

export const listWorkflows = async (
  opts: WorkflowListQuery = {},
): Promise<readonly WorkflowHeader[]> => {
  const query: { q?: string; coordinatorAgent?: string; createdSince?: string } = {};
  if (opts.q !== undefined && opts.q !== "") query.q = opts.q;
  if (opts.coordinatorAgent !== undefined && opts.coordinatorAgent !== "") {
    query.coordinatorAgent = opts.coordinatorAgent;
  }
  if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
  return unwrap(await getApiWorkspacesByIdWorkflows({ path: { id: requireWorkspaceId() }, query }));
};

export const getWorkflow = async (workflowId: string): Promise<WorkflowHeader> =>
  unwrap(
    await getApiWorkspacesByIdWorkflowsByWfid({
      path: { id: requireWorkspaceId(), wfid: workflowId },
    }),
  );

export const getWorkflowDag = (workflowId: string): Promise<WorkflowDag> =>
  fetchJson<WorkflowDag>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/dag`,
    "workflow dag",
  );

export const createWorkflow = async (body: CreateWorkflowRequest): Promise<WorkflowHeader> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdWorkflowsResponses>({
      url: "/api/workspaces/{id}/workflows",
      path: { id: requireWorkspaceId() },
      body,
    }),
  );

/**
 * Cancel a workflow. The wire shape requires a `cancellation: { message }`
 * body; the dashboard always sends `kind:
 * "user"` (the only kind operator-driven cancels emit). Empty message
 * is allowed but the `cancellation` object itself is required.
 */
export const cancelWorkflow = async (
  workflowId: string,
  body: CancelWorkflowRequest,
): Promise<WorkflowHeader> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdWorkflowsByWfidCancelResponses>({
      url: "/api/workspaces/{id}/workflows/{wfid}/cancel",
      path: { id: requireWorkspaceId(), wfid: workflowId },
      body,
    }),
  );

/**
 * Delete a terminal workflow. Default ("archive") drops only the
 * substrate metadata rows — the on-disk shared workflow dir and
 * per-node task workdirs stay so the operator can still inspect the
 * run after the fact. `{ purge: true }` is the hard-delete path:
 * substrate rows + workflow dir + per-node task workdirs + runtime
 * state all go.
 *
 * Server returns 409 when the workflow is still running (`unwrap()`
 * throws the typed envelope; callers parse `code` +
 * `transition` to render a "Cancel first" CTA, mirroring the task
 * delete pattern).
 */
export const deleteWorkflow = async (
  workflowId: string,
  opts?: { purge?: boolean },
): Promise<void> => {
  const query: { purge?: "1" } = {};
  if (opts?.purge) query.purge = "1";
  unwrap(
    await deleteApiWorkspacesByIdWorkflowsByWfid({
      path: { id: requireWorkspaceId(), wfid: workflowId },
      query,
    }),
  );
};

/**
 * Workflow artifact list. Returns an aggregated `{ artifacts: [] }`
 * response covering both the curated workflow-summary namespace
 * (`<workflowDir>/artifact/`) and per-node artifact namespaces
 * (`<tasksRoot>/<taskId>/artifact/`).
 *
 * The wire type is the source of truth for the shape.
 */
export const listWorkflowArtifacts = async (
  workflowId: string,
): Promise<WorkflowArtifactsResponse> =>
  unwrap(
    await getApiWorkspacesByIdWorkflowsByWfidArtifacts({
      path: { id: requireWorkspaceId(), wfid: workflowId },
    }),
  );

/**
 * URL builder for the single-artifact static-bytes endpoint. The
 * caller passes a sentinel-prefixed sub-path:
 *
 *   - `summary/<rest>`           — workflow-summary artifact
 *   - `nodes/<nodeId>/<rest>`    — per-node artifact
 *
 * The whole sub-path is `encodeURIComponent`-d so `/` becomes `%2F`
 * (the server reads it as one Hono path segment). Callers use this
 * URL for `<img src>` / `<a href>` / `<iframe src>` without any
 * additional `fetch` wrapping.
 */
export const workflowArtifactUrl = (workflowId: string, subPath: string): string =>
  `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/artifacts/${encodeURIComponent(subPath)}`;

export const respondHumanNode = (
  workflowId: string,
  nodeId: string,
  body: RespondHumanNodeRequest,
): Promise<WorkflowNode> =>
  mutateJson<WorkflowNode>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/respond`,
    jsonInit("POST", body),
  );
