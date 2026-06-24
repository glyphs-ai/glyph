/**
 * `glyph workflow ...` read/control subcommands: list / create / show /
 * node-show / dag / cancel / rm. Render helpers (`renderHeader`,
 * `agentForSpec`) live in `./_shared.ts`; commander wiring is in
 * `../../registrars/workflow.ts`.
 */

import type { CancelWorkflowBody, CreateWorkflowBody } from "@glyphs-ai/contracts";
import { makeClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { agentForSpec, renderHeader } from "./_shared.js";

// --- list --------------------------------------------------------------
export interface WorkflowListOpts extends WorkspaceFlagOpts {
  /**
   * Case-sensitive substring match on the workflow id. Maps to the
   * HTTP query parameter `q` (the substrate forwards it to a SQL
   * `LIKE` predicate with the metacharacters escaped). Flag name
   * mirrors the wire param name.
   */
  readonly q?: string;
  /**
   * Exact match on the workflow's denormalised `coordinator_agent`
   * column. Maps to the HTTP query parameter `coordinatorAgent`.
   */
  readonly coordinatorAgent?: string;
  /**
   * ISO 8601 lower bound (inclusive) on `created_at`. Maps to the
   * HTTP query parameter `createdSince`. Mirrors
   * `task list --created-since` semantics.
   */
  readonly createdSince?: string;
}

export async function workflowList(opts: WorkflowListOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: {
      q?: string;
      coordinatorAgent?: string;
      createdSince?: string;
    } = {};
    if (opts.q !== undefined) query.q = opts.q;
    if (opts.coordinatorAgent !== undefined) query.coordinatorAgent = opts.coordinatorAgent;
    if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
    const list = await client.call("workflows.list", { params: { id: workspaceId }, query });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "brief", "coordinatorAgent", "status", "createdAt"],
        list.map((wf) => [wf.id, wf.brief, wf.coordinatorAgent, wf.status, wf.createdAt]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- create ------------------------------------------------------------
export interface WorkflowCreateOpts extends WorkspaceFlagOpts {
  /** Workflow brief -- non-empty. Maps to `CreateWorkflowBody.brief`. */
  readonly brief: string;
  /** Coordinator agent FQN -- non-empty. Maps to `CreateWorkflowBody.coordinatorAgent`. */
  readonly coordAgent: string;
  /**
   * Optional multi-line workflow context. Maps to
   * `CreateWorkflowBody.details`. The registrar resolves
   * `--details-file <path>` into this same field before the call,
   * mirroring the `task dispatch` precedent (file IO lives in the
   * registrar, the command is a thin pass-through).
   */
  readonly details?: string;
  /**
   * Opaque metadata object persisted verbatim onto the workflow row.
   * Maps to `CreateWorkflowBody.metadata`. The registrar resolves
   * `--metadata-file <path>` (file read + JSON parse + object-shape
   * validation) into this field before the call.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export async function workflowCreate(opts: WorkflowCreateOpts): Promise<CommandResult> {
  if (typeof opts.brief !== "string" || opts.brief.trim() === "") {
    return { exitCode: 2, stderr: "missing required --brief <text>\n" };
  }
  if (typeof opts.coordAgent !== "string" || opts.coordAgent.trim() === "") {
    return { exitCode: 2, stderr: "missing required --coord-agent <fqn>\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: CreateWorkflowBody = {
      brief: opts.brief,
      coordinatorAgent: opts.coordAgent,
      ...(opts.details !== undefined ? { details: opts.details } : {}),
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    };
    const created = await client.call("workflows.create", { params: { id: workspaceId }, body });
    return { exitCode: 0, stdout: renderHeader(created, opts) };
  } catch (err) {
    return formatError(err);
  }
}

// --- show --------------------------------------------------------------
export type WorkflowShowOpts = WorkspaceFlagOpts;

export async function workflowShow(
  workflowId: string,
  opts: WorkflowShowOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const found = await client.call("workflows.get", {
      params: { id: workspaceId, wfid: workflowId },
    });
    return { exitCode: 0, stdout: renderHeader(found, opts) };
  } catch (err) {
    return formatError(err);
  }
}

// --- node-show ---------------------------------------------------------
export type WorkflowNodeShowOpts = WorkspaceFlagOpts;

export async function workflowNodeShow(
  workflowId: string,
  nodeId: string,
  opts: WorkflowNodeShowOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const node = await client.call("workflows.nodes.get", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(node) };
    const rows: Array<readonly [string, string]> = [
      ["id", node.id],
      ["workflowId", node.workflowId],
      ["phase", String(node.phase)],
      ["kind", node.spec.kind],
      ["status", node.status],
      ["agent", agentForSpec(node.spec)],
      ["createdAt", node.createdAt],
    ];
    if (node.readyAt !== undefined) rows.push(["readyAt", node.readyAt]);
    if (node.runningAt !== undefined) rows.push(["runningAt", node.runningAt]);
    if (node.endedAt !== undefined) rows.push(["endedAt", node.endedAt]);
    if (node.taskId !== undefined) rows.push(["taskId", node.taskId]);
    return {
      exitCode: 0,
      stdout: `${formatTable(
        ["field", "value"],
        rows.map(([k, v]) => [k, v]),
      )}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- dag ---------------------------------------------------------------
export type WorkflowDagOpts = WorkspaceFlagOpts;

export async function workflowDag(
  workflowId: string,
  opts: WorkflowDagOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const dag = await client.call("workflows.dag.get", {
      params: { id: workspaceId, wfid: workflowId },
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(dag) };
    const nodesTable = formatTable(
      ["phase", "nodeId", "kind", "status", "agent"],
      dag.nodes.map((n) => [String(n.phase), n.id, n.spec.kind, n.status, agentForSpec(n.spec)]),
    );
    const edgeLines =
      dag.edges.length === 0
        ? "  (no edges)"
        : dag.edges.map((e) => `  ${e.from} → ${e.to}`).join("\n");
    const stdout = `${nodesTable}\nedges:\n${edgeLines}\n`;
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// --- cancel ------------------------------------------------------------
export interface WorkflowCancelOpts extends WorkspaceFlagOpts {
  /**
   * Free-text operator-supplied message persisted into the
   * workflow's `cancellation` JSON column. Empty string is allowed
   * but the flag itself MUST be present -- the route rejects `{}` with
   * a 400 because the `cancellation.message` field is required by the
   * wire contract.
   */
  readonly message?: string;
  /**
   * Cancellation kind. The CLI currently emits `"user"` and rejects
   * any other value.
   */
  readonly kind?: string;
}

export async function workflowCancel(
  workflowId: string,
  opts: WorkflowCancelOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (opts.kind !== undefined && opts.kind !== "user") {
    return { exitCode: 2, stderr: '--kind must be "user" when supplied\n' };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: CancelWorkflowBody = {
      cancellation: { kind: "user", message: opts.message ?? "" },
    };
    const updated = await client.call("workflows.cancel", {
      params: { id: workspaceId, wfid: workflowId },
      body,
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return {
      exitCode: 0,
      stdout: `workflow ${workflowId} cancelled\n${renderHeader(updated, opts)}`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- rm -----------------------------------------------------------------
export interface WorkflowRmOpts extends WorkspaceFlagOpts {
  readonly purge?: boolean;
}

export async function workflowRm(
  workflowId: string,
  opts: WorkflowRmOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { purge?: "1" } = {};
    if (opts.purge === true) query.purge = "1";
    await client.call("workflows.delete", {
      params: { id: workspaceId, wfid: workflowId },
      query,
    });
    return {
      exitCode: 0,
      stdout: `workflow ${workflowId} removed${opts.purge === true ? " (purged)" : ""}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}
