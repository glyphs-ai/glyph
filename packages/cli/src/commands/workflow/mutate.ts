/**
 * `glyph workflow ...` coord-callback mutation primitives that back the
 * coordinator-agent contract: add-node / add-subgraph / add-edge,
 * remove-node / remove-edge, replace-spec, cancel-node, finish. Also
 * exports the shared `readJsonFileArg` file-arg reader used by the
 * spec-file commands. Render helpers live in `./_shared.ts`; argument
 * parsing + validation helpers live in `./_validate.ts`.
 */

import { readFileSync } from "node:fs";
import type {
  AddEdgeRequest,
  AddNodeRequest,
  FinishWorkflowRequest,
  PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecResponses,
  PostApiWorkspacesByIdWorkflowsByWfidEdgesResponses,
  PostApiWorkspacesByIdWorkflowsByWfidFinishResponses,
  PostApiWorkspacesByIdWorkflowsByWfidNodesResponses,
  PostApiWorkspacesByIdWorkflowsByWfidSubgraphResponses,
  ReplaceNodeSpecRequest,
} from "@glyphs-ai/sdk";
import {
  deleteApiWorkspacesByIdWorkflowsByWfidEdgesByFromByTo,
  deleteApiWorkspacesByIdWorkflowsByWfidNodesByNid,
  postApiWorkspacesByIdWorkflowsByWfidNodesByNidCancel,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";
import { renderHeader, renderNode } from "./_shared.js";
import {
  isFinishOutcome,
  isNodeKind,
  KNOWN_FINISH_OUTCOMES,
  KNOWN_NODE_KINDS,
  parseParents,
  validateAddSubgraphRequest,
} from "./_validate.js";

/**
 * Read a `<flagName> <path>` JSON file. Returns the parsed value or
 * an `{ ok: false, error }` envelope the caller surfaces as
 * exit-code-2 usage feedback. The parsed value is intentionally typed
 * `unknown` so each caller can apply the relevant shape check.
 *
 * The `flagName` parameter (e.g. `"--spec-file"`) is woven into both
 * the "failed to read" and "JSON parse error"
 * messages so callers don't have to post-process the result.
 *
 * Callers validate the parsed `unknown` value before forwarding it.
 *
 * Exported as a shared helper so each spec-file call site keeps the
 * read+parse+error-wrap pattern in one place (no per-call-site
 * flag-name rewriting).
 *
 * Synchronous so registrar actions can read, parse, validate, and
 * dispatch in one flat control-flow block.
 */
export function readJsonFileArg(
  flagName: string,
  value: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(value, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `failed to read ${flagName}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: `${flagName} JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- add-node ----------------------------------------------------------
export interface WorkflowAddNodeOpts extends WorkspaceFlagOpts {
  readonly kind: string;
  readonly specFile: string;
  readonly parentNodeIds?: string;
}

export async function workflowAddNode(
  workflowId: string,
  opts: WorkflowAddNodeOpts,
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof opts.kind !== "string" || !isNodeKind(opts.kind)) {
    return {
      exitCode: 2,
      stderr: `--kind must be one of: ${KNOWN_NODE_KINDS.join(", ")}\n`,
    };
  }
  if (typeof opts.specFile !== "string" || opts.specFile.trim() === "") {
    return { exitCode: 2, stderr: "missing required --spec-file <path>\n" };
  }
  const specResult = readJsonFileArg("--spec-file", opts.specFile);
  if (!specResult.ok) {
    return { exitCode: 2, stderr: `${specResult.error}\n` };
  }
  const spec = specResult.value;
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: AddNodeRequest = {
      kind: opts.kind,
      spec,
      parents: parseParents(opts.parentNodeIds),
    };
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdWorkflowsByWfidNodesResponses>({
        url: "/api/workspaces/{id}/workflows/{wfid}/nodes",
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return { exitCode: 0, stdout: formatRecord({ ...result }) };
  } catch (err) {
    return formatError(err);
  }
}

// --- add-subgraph ------------------------------------------------------
export interface WorkflowAddSubgraphOpts extends WorkspaceFlagOpts {
  /**
   * Path to a JSON file with
   * `{ nodes: [{tempId, kind, spec, existingParents?}], edges: [{from, to}] }`.
   * Node refs (`{nodeId}` / `{tempId}`) are forwarded as-is.
   */
  readonly specFile: string;
}

export async function workflowAddSubgraph(
  workflowId: string,
  opts: WorkflowAddSubgraphOpts,
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof opts.specFile !== "string" || opts.specFile.trim() === "") {
    return { exitCode: 2, stderr: "missing required --spec-file <path>\n" };
  }
  const payloadResult = readJsonFileArg("--spec-file", opts.specFile);
  if (!payloadResult.ok) {
    return { exitCode: 2, stderr: `${payloadResult.error}\n` };
  }
  const bodyResult = validateAddSubgraphRequest(payloadResult.value);
  if (!bodyResult.ok) {
    return { exitCode: 2, stderr: `${bodyResult.error}\n` };
  }
  const { body } = bodyResult;
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdWorkflowsByWfidSubgraphResponses>({
        url: "/api/workspaces/{id}/workflows/{wfid}/subgraph",
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["tempId", "nodeId", "phase"],
        result.insertedNodes.map((n) => [n.tempId, n.nodeId, String(n.phase)]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- add-edge ----------------------------------------------------------
export type WorkflowAddEdgeOpts = WorkspaceFlagOpts;

export async function workflowAddEdge(
  workflowId: string,
  fromNodeId: string,
  toNodeId: string,
  opts: WorkflowAddEdgeOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof fromNodeId !== "string" || fromNodeId.trim() === "") {
    return { exitCode: 2, stderr: "missing required <from-node-id>\n" };
  }
  if (typeof toNodeId !== "string" || toNodeId.trim() === "") {
    return { exitCode: 2, stderr: "missing required <to-node-id>\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: AddEdgeRequest = { fromNodeId, toNodeId };
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdWorkflowsByWfidEdgesResponses>({
        url: "/api/workspaces/{id}/workflows/{wfid}/edges",
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return {
      exitCode: 0,
      stdout: `edge ${result.fromNodeId} → ${result.toNodeId} inserted (toPhase ${result.toPhase})\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- remove-node -------------------------------------------------------
export type WorkflowRemoveNodeOpts = WorkspaceFlagOpts;

export async function workflowRemoveNode(
  workflowId: string,
  nodeId: string,
  opts: WorkflowRemoveNodeOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 404 must surface, not be swallowed).
    unwrap(
      await deleteApiWorkspacesByIdWorkflowsByWfidNodesByNid({
        path: { id: workspaceId, wfid: workflowId, nid: nodeId },
      }),
    );
    return { exitCode: 0, stdout: `node ${nodeId} removed from workflow ${workflowId}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- remove-edge -------------------------------------------------------
export type WorkflowRemoveEdgeOpts = WorkspaceFlagOpts;

export async function workflowRemoveEdge(
  workflowId: string,
  fromNodeId: string,
  toNodeId: string,
  opts: WorkflowRemoveEdgeOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof fromNodeId !== "string" || fromNodeId.trim() === "") {
    return { exitCode: 2, stderr: "missing required <from-node-id>\n" };
  }
  if (typeof toNodeId !== "string" || toNodeId.trim() === "") {
    return { exitCode: 2, stderr: "missing required <to-node-id>\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 404 must surface, not be swallowed).
    unwrap(
      await deleteApiWorkspacesByIdWorkflowsByWfidEdgesByFromByTo({
        path: { id: workspaceId, wfid: workflowId, from: fromNodeId, to: toNodeId },
      }),
    );
    return {
      exitCode: 0,
      stdout: `edge ${fromNodeId} → ${toNodeId} removed from workflow ${workflowId}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- replace-spec ------------------------------------------------------
export interface WorkflowReplaceSpecOpts extends WorkspaceFlagOpts {
  readonly specFile: string;
}

export async function workflowReplaceSpec(
  workflowId: string,
  nodeId: string,
  opts: WorkflowReplaceSpecOpts,
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  if (typeof opts.specFile !== "string" || opts.specFile.trim() === "") {
    return { exitCode: 2, stderr: "missing required --spec-file <path>\n" };
  }
  const newSpecResult = readJsonFileArg("--spec-file", opts.specFile);
  if (!newSpecResult.ok) {
    return { exitCode: 2, stderr: `${newSpecResult.error}\n` };
  }
  const newSpec = newSpecResult.value;
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: ReplaceNodeSpecRequest = { newSpec };
    const updated = unwrap(
      await client.patch<PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecResponses>({
        url: "/api/workspaces/{id}/workflows/{wfid}/nodes/{nid}/spec",
        path: { id: workspaceId, wfid: workflowId, nid: nodeId },
        body,
      }),
    );
    return { exitCode: 0, stdout: renderNode(updated, opts) };
  } catch (err) {
    return formatError(err);
  }
}

// --- cancel-node -------------------------------------------------------
export type WorkflowCancelNodeOpts = WorkspaceFlagOpts;

export async function workflowCancelNode(
  workflowId: string,
  nodeId: string,
  opts: WorkflowCancelNodeOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const updated = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidNodesByNidCancel({
        path: { id: workspaceId, wfid: workflowId, nid: nodeId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `node ${nodeId} cancelled\n${renderNode(updated, opts)}` };
  } catch (err) {
    return formatError(err);
  }
}

// --- finish ------------------------------------------------------------
export interface WorkflowFinishOpts extends WorkspaceFlagOpts {
  /**
   * Coordinator's free-form summary persisted into `success.output`
   * when `--outcome succeeded`. Mutually exclusive with `--message`.
   * `null` (no value supplied) is persisted as a null `output` field.
   */
  readonly summary?: string;
  /**
   * Failure message persisted into `failure.message` when
   * `--outcome failed`. REQUIRED when the outcome is `failed`
   * (empty string is allowed).
   */
  readonly message?: string;
}

export async function workflowFinish(
  workflowId: string,
  outcome: string,
  opts: WorkflowFinishOpts = {},
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof outcome !== "string" || !isFinishOutcome(outcome)) {
    return {
      exitCode: 2,
      stderr: `--outcome must be one of: ${KNOWN_FINISH_OUTCOMES.join(", ")}\n`,
    };
  }
  if (outcome === "failed" && opts.message === undefined) {
    return {
      exitCode: 2,
      stderr: "--message is required when --outcome failed\n",
    };
  }
  if (outcome === "succeeded" && opts.message !== undefined) {
    return {
      exitCode: 2,
      stderr: "--message is only valid with --outcome failed; use --summary instead\n",
    };
  }
  if (outcome === "failed" && opts.summary !== undefined) {
    return {
      exitCode: 2,
      stderr: "--summary is only valid with --outcome succeeded; use --message instead\n",
    };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: FinishWorkflowRequest =
      outcome === "succeeded"
        ? { kind: "succeeded", success: { output: opts.summary ?? null } }
        : { kind: "failed", failure: { kind: "coordinator", message: opts.message ?? "" } };
    const updated = unwrap(
      await client.post<PostApiWorkspacesByIdWorkflowsByWfidFinishResponses>({
        url: "/api/workspaces/{id}/workflows/{wfid}/finish",
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return {
      exitCode: 0,
      stdout: `workflow ${workflowId} finished as ${outcome}\n${renderHeader(updated, opts)}`,
    };
  } catch (err) {
    return formatError(err);
  }
}
