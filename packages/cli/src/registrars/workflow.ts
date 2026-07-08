/**
 * `workflow` subtree registrar. Mirrors `registrars/schedule.ts` —
 * each subcommand is a one-shot commander chain (`.command(…).option(…).action(…)`)
 * with no business logic; everything flows to `commands/workflow.ts`.
 *
 * Help-text, option flags, ordering, and command names are the
 * canonical surface for the CLI; see `commands/workflow.ts` doc-block
 * for the design rationale behind each flag.
 *
 * Mutation primitives: add-node / add-subgraph / add-edge / prune-subgraph /
 * update-spec / cancel-node / finish — the DAG-growth + terminal primitives a
 * coord agent calls via HTTP from its task. A still-`not_started` node can be
 * retracted (prune-subgraph) or have its spec patched (update-spec);
 * started / terminal nodes are immutable.
 */

import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  workflowAddEdge,
  workflowAddNode,
  workflowAddSubgraph,
  workflowCancel,
  workflowCancelNode,
  workflowCreate,
  workflowDag,
  workflowFinish,
  workflowList,
  workflowNodeShow,
  workflowPruneSubgraph,
  workflowRespond,
  workflowRm,
  workflowShow,
  workflowUpdateSpec,
} from "../commands/workflow.js";
import {
  optionalString,
  parseWorkspaceFlags,
  pickString,
  type Slot,
  withWorkspaceFlags,
} from "./_shared.js";

export function registerWorkflowCommands(program: Command, slot: Slot): void {
  const workflowCmd = program
    .command("workflow")
    .description("Workflow operations (workspace-scoped DAG runs)");

  withWorkspaceFlags(workflowCmd.command("list"))
    .description("List workflows in the current workspace")
    .option("--q <pattern>", "Substring match on workflow id (HTTP query: q)")
    .option(
      "--coordinator-agent <value>",
      "Exact match on the workflow's denormalised coordinator-agent FQN (HTTP query: coordinatorAgent). The server validates FQN format; this CLI forwards the value verbatim.",
    )
    .option(
      "--created-since <iso>",
      "Drop workflows created before this ISO 8601 timestamp (HTTP query: createdSince)",
    )
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await workflowList({
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "q"),
        ...optionalString(opts, "coordinatorAgent"),
        ...optionalString(opts, "createdSince"),
      });
    });

  withWorkspaceFlags(workflowCmd.command("create"))
    .description("Seed a new workflow + its initial coordinator node")
    .requiredOption("--brief <text>", "Workflow brief (non-empty)")
    .requiredOption(
      "--coord-agent <fqn>",
      "Coordinator agent FQN (e.g. official/coordinator); must declare the official/workflow-coordination skill",
    )
    .option("--details <text>", "Optional multi-line workflow context")
    .option(
      "--details-file <path>",
      "Read --details from a UTF-8 file (mutually exclusive with --details)",
    )
    .action(async (opts: Record<string, unknown>) => {
      // `--details-file` IO lives here in the registrar (not in
      // `commands/workflow.ts`) — same shape as the `task dispatch`
      // action just above: the registrar does the file read, and the
      // command function takes the already-resolved string. Keeps the
      // command-layer body a thin pass-through to the HTTP client.
      const detailsInline = pickString(opts, "details");
      const detailsFile = pickString(opts, "detailsFile");
      if (detailsInline !== undefined && detailsFile !== undefined) {
        slot.result = {
          exitCode: 2,
          stderr: "--details and --details-file are mutually exclusive\n",
        };
        return;
      }
      let details: string | undefined = detailsInline;
      if (detailsFile !== undefined) {
        try {
          details = readFileSync(detailsFile, "utf8");
        } catch (err) {
          slot.result = {
            exitCode: 2,
            stderr: `failed to read --details-file: ${err instanceof Error ? err.message : String(err)}\n`,
          };
          return;
        }
      }
      slot.result = await workflowCreate({
        ...parseWorkspaceFlags(opts),
        brief: pickString(opts, "brief") ?? "",
        coordAgent: pickString(opts, "coordAgent") ?? "",
        ...(details !== undefined ? { details } : {}),
      });
    });

  withWorkspaceFlags(workflowCmd.command("show"))
    .description("Print one workflow's header (status, iterationCount, timestamps)")
    .argument("<workflow-id>", "Workflow id")
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowShow(workflowId, parseWorkspaceFlags(opts));
    });

  withWorkspaceFlags(workflowCmd.command("node-show"))
    .description("Print one workflow node's projected wire shape")
    .argument("<workflow-id>", "Workflow id")
    .argument("<node-id>", "Node id within the workflow")
    .action(async (workflowId: string, nodeId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowNodeShow(workflowId, nodeId, parseWorkspaceFlags(opts));
    });

  withWorkspaceFlags(workflowCmd.command("dag"))
    .description("Print the full DAG snapshot (header + nodes + edges)")
    .argument("<workflow-id>", "Workflow id")
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowDag(workflowId, parseWorkspaceFlags(opts));
    });

  withWorkspaceFlags(workflowCmd.command("cancel"))
    .description(
      "Cancel a running workflow (flips status → cancelled, reconciles non-terminal nodes)",
    )
    .argument("<workflow-id>", "Workflow id")
    .option(
      "--message <text>",
      "Free-text operator message persisted into cancellation.message (v2.2; defaults to empty)",
    )
    .option("--kind <kind>", 'Cancellation kind (v2.2 only emits "user"; defaults to "user")')
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowCancel(workflowId, {
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "message"),
        ...optionalString(opts, "kind"),
      });
    });

  withWorkspaceFlags(workflowCmd.command("rm"))
    .description("Remove a terminal workflow")
    .argument("<workflow-id>", "Workflow id")
    .option("--purge", "Hard delete: also remove workflow/task workdirs and runtime state")
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowRm(workflowId, {
        ...parseWorkspaceFlags(opts),
        purge: opts.purge === true,
      });
    });

  // ─── coord-callback mutations ───────────────────────────────────

  withWorkspaceFlags(workflowCmd.command("add-node"))
    .description("Coord-only: insert one node attached to one or more existing parents")
    .argument("<workflow-id>", "Workflow id")
    .requiredOption("--kind <kind>", "Node kind (coordinator | worker)")
    .requiredOption("--spec-file <path>", "Path to JSON file holding the opaque per-kind spec")
    .option(
      "--parent-node-ids <ids>",
      "Comma-separated parent node ids (≥1 required; substrate rejects empty)",
    )
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowAddNode(workflowId, {
        ...parseWorkspaceFlags(opts),
        kind: pickString(opts, "kind") ?? "",
        specFile: pickString(opts, "specFile") ?? "",
        ...optionalString(opts, "parentNodeIds"),
      });
    });

  withWorkspaceFlags(workflowCmd.command("add-subgraph"))
    .description("Coord-only: insert N nodes + intra-batch edges atomically")
    .argument("<workflow-id>", "Workflow id")
    .requiredOption(
      "--spec-file <path>",
      "Path to JSON file matching { nodes:[{tempId,kind,spec,existingParents?}], edges:[{from,to}] }",
    )
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowAddSubgraph(workflowId, {
        ...parseWorkspaceFlags(opts),
        specFile: pickString(opts, "specFile") ?? "",
      });
    });

  withWorkspaceFlags(workflowCmd.command("prune-subgraph"))
    .description("Coord-only: retract N not-started nodes + their adjacent edges atomically")
    .argument("<workflow-id>", "Workflow id")
    .requiredOption("--spec-file <path>", "Path to JSON file matching { nodeIds:[id,...] }")
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowPruneSubgraph(workflowId, {
        ...parseWorkspaceFlags(opts),
        specFile: pickString(opts, "specFile") ?? "",
      });
    });

  withWorkspaceFlags(workflowCmd.command("update-spec"))
    .description("Coord-only: patch a not-started worker/human node's spec (partial, whitelisted)")
    .argument("<workflow-id>", "Workflow id")
    .argument("<node-id>", "Node id (must be not_started; coordinator nodes are rejected)")
    .requiredOption(
      "--patch <path>",
      "Path to a JSON file with the partial patch — either { patch: {...} } or the patch object directly",
    )
    .action(async (workflowId: string, nodeId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowUpdateSpec(workflowId, nodeId, {
        ...parseWorkspaceFlags(opts),
        patch: pickString(opts, "patch") ?? "",
      });
    });

  withWorkspaceFlags(workflowCmd.command("add-edge"))
    .description("Coord-only: add a single edge between two existing nodes")
    .argument("<workflow-id>", "Workflow id")
    .requiredOption("--from-node-id <id>", "Source node id")
    .requiredOption("--to-node-id <id>", "Destination node id (must be not_started)")
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowAddEdge(
        workflowId,
        pickString(opts, "fromNodeId") ?? "",
        pickString(opts, "toNodeId") ?? "",
        parseWorkspaceFlags(opts),
      );
    });

  withWorkspaceFlags(workflowCmd.command("cancel-node"))
    .description(
      "Coord-only: cancel a single worker node (coord-kind targets are rejected with 409)",
    )
    .argument("<workflow-id>", "Workflow id")
    .argument("<node-id>", "Node id")
    .action(async (workflowId: string, nodeId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowCancelNode(workflowId, nodeId, parseWorkspaceFlags(opts));
    });

  withWorkspaceFlags(workflowCmd.command("finish"))
    .description("Coord-only: flip the workflow terminal (outcome: succeeded | failed)")
    .argument("<workflow-id>", "Workflow id")
    .requiredOption("--outcome <outcome>", "Terminal outcome (succeeded | failed)")
    .option(
      "--summary <text>",
      "Coordinator summary persisted into success.output (only with --outcome succeeded)",
    )
    .option(
      "--message <text>",
      "Failure message persisted into failure.message (required with --outcome failed)",
    )
    .action(async (workflowId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowFinish(workflowId, pickString(opts, "outcome") ?? "", {
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "summary"),
        ...optionalString(opts, "message"),
      });
    });

  withWorkspaceFlags(workflowCmd.command("respond"))
    .description("Respond to a human-kind node that is waiting for input")
    .argument("<workflow-id>", "Workflow id")
    .argument("<node-id>", "Node id")
    .option("--choice-id <id>", "Choice id (one of the spec choices)")
    .option("--input <text>", "Freeform text input (required when --choice-id is not provided)")
    .action(async (workflowId: string, nodeId: string, opts: Record<string, unknown>) => {
      slot.result = await workflowRespond(workflowId, nodeId, {
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "choiceId"),
        ...optionalString(opts, "input"),
      });
    });
}
