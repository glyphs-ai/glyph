import type {
  CancelWorkflowRequest,
  CreateWorkflowRequest,
  RespondHumanNodeRequest,
  WorkflowArtifact,
  WorkflowArtifactsResponse,
  WorkflowDag,
  WorkflowEdge,
  WorkflowHeader,
  WorkflowHumanNodeSpec,
  WorkflowListQuery,
  WorkflowNode,
  WorkflowNodeSpec,
} from "@glyphs-ai/contracts";
import { fetchJson, jsonInit, mutate, mutateJson, workspacePrefix } from "./http.js";

export type {
  CancelWorkflowRequest,
  CreateWorkflowRequest,
  RespondHumanNodeRequest,
  WorkflowArtifact,
  WorkflowArtifactsResponse,
  WorkflowDag,
  WorkflowEdge,
  WorkflowHeader,
  WorkflowHumanNodeSpec,
  WorkflowListQuery,
  WorkflowNode,
  WorkflowNodeSpec,
};

export const listWorkflows = (opts: WorkflowListQuery = {}): Promise<readonly WorkflowHeader[]> => {
  const qs = new URLSearchParams();
  if (opts.q !== undefined && opts.q !== "") qs.set("q", opts.q);
  if (opts.coordinatorAgent !== undefined && opts.coordinatorAgent !== "") {
    qs.set("coordinatorAgent", opts.coordinatorAgent);
  }
  if (opts.createdSince !== undefined) qs.set("createdSince", opts.createdSince);
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<readonly WorkflowHeader[]>(
    `${workspacePrefix()}/workflows${suffix}`,
    "workflows",
  );
};

export const getWorkflow = (workflowId: string): Promise<WorkflowHeader> =>
  fetchJson<WorkflowHeader>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}`,
    "workflow",
  );

export const getWorkflowDag = (workflowId: string): Promise<WorkflowDag> =>
  fetchJson<WorkflowDag>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/dag`,
    "workflow dag",
  );

export const createWorkflow = (body: CreateWorkflowRequest): Promise<WorkflowHeader> =>
  mutateJson<WorkflowHeader>(`${workspacePrefix()}/workflows`, jsonInit("POST", body));

/**
 * Cancel a workflow. The wire shape requires a `cancellation: { message }`
 * body; the dashboard always sends `kind:
 * "user"` (the only kind operator-driven cancels emit). Empty message
 * is allowed but the `cancellation` object itself is required.
 */
export const cancelWorkflow = (
  workflowId: string,
  body: CancelWorkflowRequest,
): Promise<WorkflowHeader> =>
  mutateJson<WorkflowHeader>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/cancel`,
    jsonInit("POST", body),
  );

/**
 * Delete a terminal workflow. Default ("archive") drops only the
 * substrate metadata rows — the on-disk shared workflow dir and
 * per-node task workdirs stay so the operator can still inspect the
 * run after the fact. `{ purge: true }` is the hard-delete path:
 * substrate rows + workflow dir + per-node task workdirs + runtime
 * state all go.
 *
 * Server returns 409 when the workflow is still running (mutate()
 * throws the typed envelope; callers parse `code` +
 * `transition` to render a "Cancel first" CTA, mirroring the task
 * delete pattern).
 */
export const deleteWorkflow = (workflowId: string, opts?: { purge?: boolean }) => {
  const qs = opts?.purge ? "?purge=1" : "";
  return mutate(`${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}${qs}`, {
    method: "DELETE",
  });
};

/**
 * Workflow artifact list. Returns an aggregated `{ artifacts: [] }`
 * response covering both the curated workflow-summary namespace
 * (`<workflowDir>/artifact/`) and per-node artifact namespaces
 * (`<tasksRoot>/<taskId>/artifact/`).
 *
 * The contracts type is the source of truth for the wire shape.
 */
export const listWorkflowArtifacts = (workflowId: string): Promise<WorkflowArtifactsResponse> =>
  fetchJson<WorkflowArtifactsResponse>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/artifacts`,
    "workflow artifacts",
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

/**
 * Respond to a human-kind workflow node that is in `running` status.
 * Returns the updated node wire shape.
 */
export const respondHumanNode = (
  workflowId: string,
  nodeId: string,
  body: RespondHumanNodeRequest,
): Promise<WorkflowNode> =>
  mutateJson<WorkflowNode>(
    `${workspacePrefix()}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/respond`,
    jsonInit("POST", body),
  );
