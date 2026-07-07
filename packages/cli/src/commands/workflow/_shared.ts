/**
 * Shared render helpers for the `glyph workflow ...` command split:
 * `renderHeader` (workflow header -> table/json), `agentForSpec`
 * (node-spec agent column), and `renderNode` (node -> table/json).
 * Consumed by the read / mutate / respond concern modules.
 */

import type { GetApiWorkspacesByIdWorkflowsByWfidResponse } from "@glyphs-ai/sdk";
import { formatJson, formatRecord, pickFormat } from "../../output.js";

type WorkflowHeader = GetApiWorkspacesByIdWorkflowsByWfidResponse;

/** Render a workflow header via either JSON or the record formatter. */
export function renderHeader(
  header: WorkflowHeader,
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(header);
  return formatRecord({ ...header });
}

function isSpecLike(s: unknown): s is { readonly kind: string; readonly agent?: string } {
  return (
    typeof s === "object" &&
    s !== null &&
    "kind" in s &&
    typeof (s as { kind: unknown }).kind === "string"
  );
}

export function agentForSpec(spec: unknown): string {
  return isSpecLike(spec) && typeof spec.agent === "string" ? spec.agent : "";
}

/** Extract the `kind` string from a node spec, or `"unknown"` if absent. */
export function specKind(spec: unknown): string {
  return isSpecLike(spec) ? spec.kind : "unknown";
}

/**
 * Render a workflow node via either JSON or the record formatter.
 * Accepts `spec?: unknown` so callers with SDK-typed nodes (where spec
 * is `unknown` on the wire) are directly assignable without a cast.
 */
export function renderNode(
  node: {
    readonly id: string;
    readonly phase: number;
    readonly status: string;
    readonly spec?: unknown;
    readonly specVersion?: number;
    readonly createdAt: string;
    readonly readyAt?: string;
    readonly runningAt?: string;
    readonly endedAt?: string;
  },
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(node);
  const specKind = isSpecLike(node.spec) ? node.spec.kind : "";
  return formatRecord({
    id: node.id,
    phase: node.phase,
    kind: specKind,
    status: node.status,
    agent: agentForSpec(node.spec),
    ...(node.specVersion !== undefined ? { specVersion: node.specVersion } : {}),
    createdAt: node.createdAt,
    ...(node.readyAt !== undefined ? { readyAt: node.readyAt } : {}),
    ...(node.runningAt !== undefined ? { runningAt: node.runningAt } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
  });
}
