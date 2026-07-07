/**
 * `glyph workflow ...` coord-callback mutation primitives that back the
 * coordinator-agent contract: add-node / add-subgraph / add-edge /
 * prune-subgraph, update-spec, cancel-node, finish. Also exports the shared
 * `readJsonFileArg` file-arg reader used by the spec-file commands. Render
 * helpers live in `./_shared.ts`; argument parsing + validation helpers live
 * in `./_validate.ts`. A still-`not_started` node can be retracted (via
 * prune-subgraph) or have its spec patched (via update-spec); once a node has
 * started it is immutable — there is no remove-started-node, and update-spec
 * refuses any node that has left `not_started`.
 */

import { readFileSync } from "node:fs";
import type {
  PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecData,
  PostApiWorkspacesByIdWorkflowsByWfidFinishData,
  PostApiWorkspacesByIdWorkflowsByWfidSubgraphData,
} from "@glyphs-ai/sdk";
import {
  getApiWorkspacesByIdWorkflowsByWfidNodesByNid,
  patchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpec,
  postApiWorkspacesByIdWorkflowsByWfidFinish,
  postApiWorkspacesByIdWorkflowsByWfidNodesByNidCancel,
  postApiWorkspacesByIdWorkflowsByWfidPrune,
  postApiWorkspacesByIdWorkflowsByWfidSubgraph,
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
  validateNodeSpecPatch,
  validatePruneSubgraphRequest,
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const existingParents = parseParents(opts.parentNodeIds);
    // opts.kind is narrowed to WorkflowNodeKind by the isNodeKind guard above.
    const nodeKind = opts.kind as "coordinator" | "worker" | "human";
    const body: PostApiWorkspacesByIdWorkflowsByWfidSubgraphData["body"] = {
      nodes: [
        {
          tempId: "n0",
          kind: nodeKind,
          spec,
          ...(existingParents.length > 0 ? { existingParents } : {}),
        },
      ],
      edges: [],
    };
    const result = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidSubgraph({
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    const node = result.insertedNodes[0];
    return {
      exitCode: 0,
      stdout: node ? formatRecord({ nodeId: node.nodeId, phase: node.phase }) : "node added\n",
    };
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidSubgraph({
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

// --- prune-subgraph ----------------------------------------------------
export interface WorkflowPruneSubgraphOpts extends WorkspaceFlagOpts {
  /**
   * Path to a JSON file with `{ nodeIds: [id, ...] }` — the still-`not_started`
   * nodes to retract along with their adjacent edges.
   */
  readonly specFile: string;
}

export async function workflowPruneSubgraph(
  workflowId: string,
  opts: WorkflowPruneSubgraphOpts,
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
  const bodyResult = validatePruneSubgraphRequest(payloadResult.value);
  if (!bodyResult.ok) {
    return { exitCode: 2, stderr: `${bodyResult.error}\n` };
  }
  const { body } = bodyResult;
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidPrune({
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["prunedNodeId"],
        result.prunedNodeIds.map((id) => [id]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- update-spec -------------------------------------------------------
export interface WorkflowUpdateSpecOpts extends WorkspaceFlagOpts {
  /**
   * Path to a JSON file holding the partial spec patch. Accepts either the
   * patch object directly (only the fields to change — worker: `agent` /
   * `brief` / `details` / `runtime`; human: `prompt` / `promptStyle` /
   * `choices`) or a `{ patch: {...} }` wrapper. The node's kind is read via a
   * pre-GET, so there is no `--kind` flag.
   */
  readonly patch: string;
  /**
   * Required optimistic-concurrency guard: the node's current `specVersion`
   * (read it via `workflow node-show <wfid> <nid> --json`). A stale value is
   * rejected by the server with 409 SpecVersionConflict.
   */
  readonly expectSpecVersion: string;
}

/**
 * Patch a still-`not_started` worker/human node's spec. The command first
 * GETs the node to resolve its kind (coordinator nodes are rejected — their
 * spec is not editable), then PATCHes the partial patch under the supplied
 * `--expect-spec-version`. The server shallow-merges the patch onto the
 * current spec, re-validates the merged spec authoritatively, and bumps
 * `specVersion` by one (returned as `newSpecVersion`).
 */
export async function workflowUpdateSpec(
  workflowId: string,
  nodeId: string,
  opts: WorkflowUpdateSpecOpts,
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  if (typeof opts.patch !== "string" || opts.patch.trim() === "") {
    return { exitCode: 2, stderr: "missing required --patch <path>\n" };
  }
  if (typeof opts.expectSpecVersion !== "string" || opts.expectSpecVersion.trim() === "") {
    return { exitCode: 2, stderr: "missing required --expect-spec-version <n>\n" };
  }
  const expectedSpecVersion = Number(opts.expectSpecVersion);
  if (!Number.isInteger(expectedSpecVersion) || expectedSpecVersion < 0) {
    return { exitCode: 2, stderr: "--expect-spec-version must be a non-negative integer\n" };
  }
  const patchResult = readJsonFileArg("--patch", opts.patch);
  if (!patchResult.ok) {
    return { exitCode: 2, stderr: `${patchResult.error}\n` };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const node = unwrap(
      await getApiWorkspacesByIdWorkflowsByWfidNodesByNid({
        path: { id: workspaceId, wfid: workflowId, nid: nodeId },
      }),
    );
    if (node.kind === "coordinator") {
      return {
        exitCode: 2,
        stderr: `node ${nodeId} is a coordinator; its spec is not editable\n`,
      };
    }
    const targetResult = validateNodeSpecPatch(node.kind, patchResult.value);
    if (!targetResult.ok) {
      return { exitCode: 2, stderr: `${targetResult.error}\n` };
    }
    const body: PatchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpecData["body"] = {
      expectedSpecVersion,
      target: targetResult.target,
    };
    const result = unwrap(
      await patchApiWorkspacesByIdWorkflowsByWfidNodesByNidSpec({
        path: { id: workspaceId, wfid: workflowId, nid: nodeId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    const summary = formatRecord({
      "workflow-id": workflowId,
      "node-id": nodeId,
      kind: node.kind,
      oldSpecVersion: expectedSpecVersion,
      newSpecVersion: result.newSpecVersion,
      message: "spec updated",
    });
    return { exitCode: 0, stdout: `${summary}\n${renderNode(result.node, opts)}` };
  } catch (err) {
    return formatError(err);
  }
}

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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: PostApiWorkspacesByIdWorkflowsByWfidSubgraphData["body"] = {
      nodes: [],
      edges: [
        {
          from: { kind: "existing", id: fromNodeId },
          to: { kind: "existing", id: toNodeId },
        },
      ],
    };
    const result = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidSubgraph({
        path: { id: workspaceId, wfid: workflowId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return {
      exitCode: 0,
      stdout: `edge ${fromNodeId} → ${toNodeId} inserted\n`,
    };
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: PostApiWorkspacesByIdWorkflowsByWfidFinishData["body"] =
      outcome === "succeeded"
        ? { outcome: "succeeded", success: { output: opts.summary ?? null } }
        : { outcome: "failed", failure: { kind: "coordinator", message: opts.message ?? "" } };
    const updated = unwrap(
      await postApiWorkspacesByIdWorkflowsByWfidFinish({
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
