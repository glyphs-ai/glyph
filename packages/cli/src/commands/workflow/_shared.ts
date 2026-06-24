/**
 * Shared render helpers for the `glyph workflow ...` command split:
 * `renderHeader` (workflow header -> table/json), `agentForSpec`
 * (node-spec agent column), and `renderNode` (node -> table/json).
 * Consumed by the read / mutate / respond concern modules.
 */

import type { WorkflowHeaderWire, WorkflowNodeWire } from "@glyphs-ai/contracts";
import { formatJson, formatRecord, pickFormat } from "../../output.js";

/** Render a {@link WorkflowHeaderWire} via either JSON or the record formatter. */
export function renderHeader(
  header: WorkflowHeaderWire,
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(header);
  return formatRecord({ ...header });
}

export function agentForSpec(spec: { readonly kind: string; readonly agent?: string }): string {
  return typeof spec.agent === "string" ? spec.agent : "";
}

/** Render a {@link WorkflowNodeWire} via either JSON or the record formatter. */
export function renderNode(
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
