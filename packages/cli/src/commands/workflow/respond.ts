/**
 * `glyph workflow respond` -- submit a human node's choice/input back
 * into a paused workflow. Render helper (`renderNode`) lives in
 * `./_shared.ts`.
 */

import type { RespondHumanNodeRequest } from "@glyphs-ai/contracts";
import { makeClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { renderNode } from "./_shared.js";

// --- respond ------------------------------------------------------------
export interface WorkflowRespondOpts extends WorkspaceFlagOpts {
  readonly choiceId?: string;
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
  if (opts.choiceId === undefined) {
    if (opts.input === undefined || opts.input.trim() === "") {
      return { exitCode: 2, stderr: "--input is required when --choice-id is not provided\n" };
    }
  } else if (opts.choiceId.trim() === "") {
    return { exitCode: 2, stderr: "--choice-id must be a non-empty string\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: RespondHumanNodeRequest = {
      ...(opts.choiceId !== undefined ? { choiceId: opts.choiceId } : {}),
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    };
    const updated = await client.call("workflows.nodes.respond", {
      params: { id: workspaceId, wfid: workflowId, nid: nodeId },
      body,
    });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `node ${nodeId} responded\n${renderNode(updated, opts)}` };
  } catch (err) {
    return formatError(err);
  }
}
