/**
 * Shared render helpers for the `glyph workflow ...` command split:
 * `renderHeader` (workflow header -> table/json), `agentForSpec`
 * (node-spec agent column), and `renderNode` (node -> table/json).
 * Consumed by the read / mutate / respond concern modules.
 */

import type { WorkflowHeader } from "@glyphs-ai/contracts";
import { formatJson, formatRecord, pickFormat } from "../../output.js";

/** Render a {@link WorkflowHeader} via either JSON or the record formatter. */
export function renderHeader(
  header: WorkflowHeader,
  flags: { readonly output?: string; readonly json?: boolean } | undefined,
): string {
  const fmt = pickFormat(flags, "table");
  if (fmt === "json") return formatJson(header);
  return formatRecord({ ...header });
}

export function agentForSpec(spec: { readonly kind: string; readonly agent?: string }): string {
  return typeof spec.agent === "string" ? spec.agent : "";
}

/**
 * Render a workflow node via either JSON or the record formatter.
 *
 * Typed to the fields the renderer reads rather than a nominal DTO:
 * the SDK-projected node and the contract `WorkflowNode` agree on
 * these fields but diverge on the catch-all `spec` arm's optionality,
 * so segregating the param keeps both assignable without a cast.
 */
export function renderNode(
  node: {
    readonly id: string;
    readonly phase: number;
    readonly status: string;
    readonly spec: { readonly kind: string; readonly agent?: string };
    readonly createdAt: string;
    readonly readyAt?: string;
    readonly runningAt?: string;
    readonly endedAt?: string;
  },
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
