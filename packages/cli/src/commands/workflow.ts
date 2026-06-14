/**
 * `glyph workflow …` — workspace-scoped DAG run commands.
 *
 * Read/control subcommands: list / create / show / node-show / dag / cancel / rm.
 *
 * Coord-callback mutation primitives that back the coordinator-agent
 * contract:
 *  - `add-node` / `add-subgraph` / `add-edge`         — grow the DAG
 *  - `remove-node` / `remove-edge`                    — shrink it
 *  - `replace-spec`                                   — re-validate + swap
 *  - `cancel-node`                                    — terminate one worker
 *  - `finish`                                         — flip the workflow terminal
 *
 * Shape mirrors `commands/schedule.ts` exactly — every function takes
 * opts, returns a `CommandResult`, and the commander wiring lives in
 * `../registrars/workflow.ts`. No commander imports here; this file is
 * pure business logic so tests can call the functions directly without
 * going through argv parsing.
 *
 * Identifier convention (see `packages/cli/README.md` →
 * "Naming conventions"): the workflow id is a positional `<workflow-id>`
 * on every subcommand (matching `task <task-id>` / `schedule <schedule-id>`);
 * the node id is `<node-id>` positional on node-scoped subcommands;
 * `add-edge` / `remove-edge` take `--from-node-id` / `--to-node-id`;
 * `add-node` takes `--parent-node-ids` (csv plural).
 *
 * Flag-name choices for create / show / dag / cancel / rm:
 *  - `--brief` (not `--name`) for create — matches
 *    `CreateWorkflowBody.brief` on the wire and the
 *    `schedule create --brief` / `task dispatch --brief` precedent.
 *  - `--coord-agent` for the coordinator agent FQN, mapping to
 *    `CreateWorkflowBody.coordinatorAgent`.
 *  - `--message` / `--kind` on cancel send the terminal payload
 *    (`cancellation: { kind, message }`).
 *  - `--summary` on finish (succeeded path) → `success.output`.
 *    `--message` on finish (failed path) → `failure.message`.
 *
 * Flag-name choices for the mutation commands:
 *  - `--kind <coordinator|worker>` for `add-node` / `add-subgraph`,
 *    matching the substrate's `NodeKind` (the wire alias is
 *    `WorkflowNodeKindWire`). Note: the existing dag-projection wire
 *    spells worker-kind as `"task"` for historical reasons (an early
 *    landing predates the kind rename); add/replace bodies use the
 *    substrate canonical names because they hit the un-projected
 *    write path.
 *  - `--spec-file <path>` (not inline `--spec`) for the opaque spec
 *    payload, because per-kind specs are routinely multi-line JSON
 *    (instructions, parents, etc) and shell-quoting is hostile. Same
 *    rationale as `catalog skill upsert --content-file`. No inline
 *    `--spec` overload is provided — agents always write a temp file
 *    via the host filesystem.
 *  - `--parent-node-ids <ids>` on add-node is comma-separated; empty is
 *    rejected (substrate emits `EmptyParentsError` → 400). On
 *    add-subgraph, intra-batch parents go in the spec file via the
 *    nodes[].existingParents array.
 *  - `--outcome <succeeded|failed>` on finish — the only enum-typed
 *    flag; both values are accepted (cancellation is the separate
 *    `workflow cancel` route).
 *
 * Auth note: every mutation command requires the caller to be running as
 * a workflow's coordinator task (the substrate's `WorkflowMutation
 * UnauthorizedError` → 403). A human at a terminal will get rejected
 * with a clear HTTP 403 + structured body; the CLI is here for
 * scripted use from a coord agent's task command line.
 */

import { readFileSync } from "node:fs";
import type {
  AddEdgeBody,
  AddNodeBody,
  AddSubgraphBody,
  AddSubgraphEdgeInputWire,
  AddSubgraphNodeInputWire,
  CancelWorkflowBody,
  CreateWorkflowBody,
  FinishWorkflowBody,
  NodeRefWire,
  ReplaceNodeSpecBody,
  RespondHumanNodeBody,
  WorkflowHeaderWire,
  WorkflowNodeKindWire,
  WorkflowNodeWire,
} from "@glyphs-ai/contracts";
import { makeClient, resolveWorkspace } from "../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../output.js";
import type { CommandResult } from "../result.js";

interface CommonFlags {
  readonly server?: string;
  readonly home?: string;
  readonly workspaceId?: string;
  readonly output?: string;
  readonly json?: boolean;
}

// ─── list ──────────────────────────────────────────────────────────────
export interface WorkflowListOpts extends CommonFlags {
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

// ─── create ────────────────────────────────────────────────────────────
export interface WorkflowCreateOpts extends CommonFlags {
  /** Workflow brief — non-empty. Maps to `CreateWorkflowBody.brief`. */
  readonly brief: string;
  /** Coordinator agent FQN — non-empty. Maps to `CreateWorkflowBody.coordinatorAgent`. */
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

// ─── show ──────────────────────────────────────────────────────────────
export type WorkflowShowOpts = CommonFlags;

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

// ─── node-show ─────────────────────────────────────────────────────────
export type WorkflowNodeShowOpts = CommonFlags;

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

// ─── dag ───────────────────────────────────────────────────────────────
export type WorkflowDagOpts = CommonFlags;

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

// ─── cancel ────────────────────────────────────────────────────────────
export interface WorkflowCancelOpts extends CommonFlags {
  /**
   * Free-text operator-supplied message persisted into the
   * workflow's `cancellation` JSON column. Empty string is allowed
   * but the flag itself MUST be present — the route rejects `{}` with
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

// ─── rm ─────────────────────────────────────────────────────────────────
export interface WorkflowRmOpts extends CommonFlags {
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

// ─── helpers ───────────────────────────────────────────────────────────

/** Render a {@link WorkflowHeaderWire} via either JSON or the record formatter. */
function renderHeader(
  header: WorkflowHeaderWire,
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(header);
  return formatRecord({ ...header });
}

function agentForSpec(spec: { readonly kind: string; readonly agent?: string }): string {
  return typeof spec.agent === "string" ? spec.agent : "";
}

// ───coord-callback mutations ─────────────────────────────────────

const KNOWN_NODE_KINDS: readonly WorkflowNodeKindWire[] = ["coordinator", "worker", "human"];
const KNOWN_FINISH_OUTCOMES: readonly ("succeeded" | "failed")[] = ["succeeded", "failed"];

function isNodeKind(s: string): s is WorkflowNodeKindWire {
  return (KNOWN_NODE_KINDS as readonly string[]).includes(s);
}

function isFinishOutcome(s: string): s is "succeeded" | "failed" {
  return (KNOWN_FINISH_OUTCOMES as readonly string[]).includes(s);
}

/**
 * Parse `--parent-node-ids <id1,id2,...>`. Empty / unset returns `[]`;
 * the substrate rejects an empty list with `EmptyParentsError` → 400 for
 * every non-bootstrap insertion. The CLI does NOT pre-reject — the
 * server's rejection carries the canonical error name + status.
 *
 * Whitespace inside an id is preserved (substrate's
 * `InvalidWorkflowNodeIdError` will catch malformed ids); only the
 * outer comma-split is trimmed.
 */
function parseParents(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === "") return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

function validateAddSubgraphBody(
  raw: unknown,
): { ok: true; body: AddSubgraphBody } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: "--spec-file must be a JSON object with `nodes` and `edges` arrays",
    };
  }
  const nodesRaw = raw.nodes;
  const edgesRaw = raw.edges;
  if (!Array.isArray(nodesRaw) || !Array.isArray(edgesRaw)) {
    return {
      ok: false,
      error: "--spec-file must be a JSON object with `nodes` and `edges` arrays",
    };
  }

  const nodes: AddSubgraphNodeInputWire[] = [];
  for (let i = 0; i < nodesRaw.length; i += 1) {
    const node = nodesRaw[i];
    if (!isPlainObject(node)) return { ok: false, error: `nodes[${i}] must be an object` };

    const tempId = node.tempId;
    if (typeof tempId !== "string" || tempId.length === 0) {
      return { ok: false, error: `nodes[${i}].tempId must be a non-empty string` };
    }

    const kind = node.kind;
    if (typeof kind !== "string" || !isNodeKind(kind)) {
      return {
        ok: false,
        error: `nodes[${i}].kind must be one of: ${KNOWN_NODE_KINDS.join(", ")}`,
      };
    }

    if (!("spec" in node)) {
      return { ok: false, error: `nodes[${i}].spec is required` };
    }

    const existingParentsRaw = node.existingParents;
    let existingParents: readonly string[] | undefined;
    if (existingParentsRaw !== undefined) {
      if (!Array.isArray(existingParentsRaw)) {
        return { ok: false, error: `nodes[${i}].existingParents must be an array` };
      }
      const parents: string[] = [];
      for (const parent of existingParentsRaw) {
        if (typeof parent !== "string" || parent.length === 0) {
          return {
            ok: false,
            error: `nodes[${i}].existingParents entries must be non-empty strings`,
          };
        }
        parents.push(parent);
      }
      existingParents = parents;
    }

    nodes.push({
      tempId,
      kind,
      spec: node.spec,
      ...(existingParents !== undefined ? { existingParents } : {}),
    });
  }

  const edges: AddSubgraphEdgeInputWire[] = [];
  for (let i = 0; i < edgesRaw.length; i += 1) {
    const edge = edgesRaw[i];
    if (!isPlainObject(edge)) return { ok: false, error: `edges[${i}] must be an object` };
    const from = validateNodeRefInput(edge.from, `edges[${i}].from`);
    if (!from.ok) return from;
    const to = validateNodeRefInput(edge.to, `edges[${i}].to`);
    if (!to.ok) return to;
    edges.push({ from: from.value, to: to.value });
  }

  return { ok: true, body: { nodes, edges } };
}

function validateNodeRefInput(
  raw: unknown,
  path: string,
): { ok: true; value: NodeRefWire } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `${path} must be an object` };
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    return { ok: false, error: `${path} must have exactly one key: nodeId or tempId` };
  }
  if ("nodeId" in raw) {
    return typeof raw.nodeId === "string" && raw.nodeId.length > 0
      ? { ok: true, value: { nodeId: raw.nodeId } }
      : { ok: false, error: `${path}.nodeId must be a non-empty string` };
  }
  if ("tempId" in raw) {
    return typeof raw.tempId === "string" && raw.tempId.length > 0
      ? { ok: true, value: { tempId: raw.tempId } }
      : { ok: false, error: `${path}.tempId must be a non-empty string` };
  }
  return { ok: false, error: `${path} must have key nodeId or tempId` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a `<flagName> <path>` JSON file. Returns the parsed value or
 * an `{ ok: false, error }` envelope the caller surfaces as
 * exit-code-2 usage feedback. The parsed value is intentionally typed
 * `unknown` so each caller can apply the relevant shape check.
 *
 * The `flagName` parameter (e.g. `"--spec-file"`, `"--metadata-file"`)
 * is woven into both the "failed to read" and "JSON parse error"
 * messages so callers don't have to post-process the result.
 *
 * Callers validate the parsed `unknown` value before forwarding it.
 *
 * Exported because the workflow-create registrar reuses this helper
 * for `--metadata-file`, keeping the read+parse+error-wrap pattern
 * in one place (no per-call-site flag-name rewriting).
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

// ─── add-node ──────────────────────────────────────────────────────────
export interface WorkflowAddNodeOpts extends CommonFlags {
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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: AddNodeBody = {
      kind: opts.kind,
      spec,
      parents: parseParents(opts.parentNodeIds),
    };
    const result = await client.call("workflows.nodes.add", {
      params: { id: workspaceId, wfid: workflowId },
      body,
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return { exitCode: 0, stdout: formatRecord({ ...result }) };
  } catch (err) {
    return formatError(err);
  }
}

// ─── add-subgraph ──────────────────────────────────────────────────────
export interface WorkflowAddSubgraphOpts extends CommonFlags {
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
  const bodyResult = validateAddSubgraphBody(payloadResult.value);
  if (!bodyResult.ok) {
    return { exitCode: 2, stderr: `${bodyResult.error}\n` };
  }
  const { body } = bodyResult;
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("workflows.subgraph.add", {
      params: { id: workspaceId, wfid: workflowId },
      body,
    });
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

// ─── add-edge ──────────────────────────────────────────────────────────
export type WorkflowAddEdgeOpts = CommonFlags;

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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: AddEdgeBody = { fromNodeId, toNodeId };
    const result = await client.call("workflows.edges.add", {
      params: { id: workspaceId, wfid: workflowId },
      body,
    });
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

// ─── remove-node ───────────────────────────────────────────────────────
export type WorkflowRemoveNodeOpts = CommonFlags;

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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    await client.call("workflows.nodes.remove", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
    });
    return { exitCode: 0, stdout: `node ${nodeId} removed from workflow ${workflowId}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── remove-edge ───────────────────────────────────────────────────────
export type WorkflowRemoveEdgeOpts = CommonFlags;

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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    await client.call("workflows.edges.remove", {
      params: { id: workspaceId, wfid: workflowId, from: fromNodeId, to: toNodeId },
    });
    return {
      exitCode: 0,
      stdout: `edge ${fromNodeId} → ${toNodeId} removed from workflow ${workflowId}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// ─── replace-spec ──────────────────────────────────────────────────────
export interface WorkflowReplaceSpecOpts extends CommonFlags {
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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: ReplaceNodeSpecBody = { newSpec };
    const updated = await client.call("workflows.nodes.spec.replace", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
      body,
    });
    return { exitCode: 0, stdout: renderNode(updated, opts) };
  } catch (err) {
    return formatError(err);
  }
}

// ─── cancel-node ───────────────────────────────────────────────────────
export type WorkflowCancelNodeOpts = CommonFlags;

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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const updated = await client.call("workflows.nodes.cancel", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `node ${nodeId} cancelled\n${renderNode(updated, opts)}` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── finish ────────────────────────────────────────────────────────────
export interface WorkflowFinishOpts extends CommonFlags {
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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: FinishWorkflowBody =
      outcome === "succeeded"
        ? { kind: "succeeded", success: { output: opts.summary ?? null } }
        : { kind: "failed", failure: { kind: "coordinator", message: opts.message ?? "" } };
    const updated = await client.call("workflows.finish", {
      params: { id: workspaceId, wfid: workflowId },
      body,
    });
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

// ─── respond ────────────────────────────────────────────────────────────
export interface WorkflowRespondOpts extends CommonFlags {
  readonly choiceId: string;
  readonly input?: string;
}

export async function workflowRespond(
  workflowId: string,
  nodeId: string,
  opts: WorkflowRespondOpts,
): Promise<CommandResult> {
  if (typeof workflowId !== "string" || workflowId.trim() === "") {
    return { exitCode: 2, stderr: "workflow id is required (positional <workflow-id>)\n" };
  }
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    return { exitCode: 2, stderr: "node id is required (positional <node-id>)\n" };
  }
  if (typeof opts.choiceId !== "string" || opts.choiceId.trim() === "") {
    return { exitCode: 2, stderr: "--choice-id must be a non-empty string\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: RespondHumanNodeBody = {
      choiceId: opts.choiceId,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    };
    await client.call("workflows.nodes.respond", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
      body,
    });
    return { exitCode: 0, stdout: `node ${nodeId} responded\n` };
  } catch (err) {
    return formatError(err);
  }
}

/** Render a {@link WorkflowNodeWire} via either JSON or the record formatter. */
function renderNode(
  node: WorkflowNodeWire,
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(node);
  return formatRecord({
    id: node.id,
    phase: node.phase,
    kind: node.spec.kind,
    status: node.status,
    agent: agentForSpec(node.spec),
    createdAt: node.createdAt,
    ...(node.readyAt !== undefined ? { readyAt: node.readyAt } : {}),
    ...(node.runningAt !== undefined ? { runningAt: node.runningAt } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
  });
}
