/**
 * `glyph workflow ...` -- workspace-scoped DAG run commands.
 *
 * Read/control subcommands: list / create / show / node-show / dag / cancel / rm.
 *
 * Coord-callback mutation primitives that back the coordinator-agent
 * contract:
 *  - `add-node` / `add-subgraph` / `add-edge`         -- grow the DAG
 *  - `prune-subgraph`                                 -- retract not-started nodes
 *  - `update-spec`                                    -- patch a not-started node's spec
 *  - `cancel-node`                                    -- terminate one worker
 *  - `finish`                                         -- flip the workflow terminal
 *
 * The DAG grows by append; retraction is limited to still-`not_started`
 * nodes via `prune-subgraph`. A still-`not_started` node's spec can be
 * patched via `update-spec`. Once a node has started it is immutable.
 *
 * Layout: this file is a thin facade. Command implementations live in
 * sibling concern modules under `./workflow/` -- `read.ts` (list /
 * create / show / node-show / dag / cancel / rm), `mutate.ts` (the
 * coord-callback DAG mutations plus the shared `readJsonFileArg`), and
 * `respond.ts` (human-node respond). Render helpers live in
 * `./workflow/_shared.ts`; argument parsing + validation in
 * `./workflow/_validate.ts`. Commander wiring stays in
 * `../registrars/workflow.ts`.
 *
 * Identifier convention (see `packages/cli/README.md` ->
 * "Naming conventions"): the workflow id is a positional `<workflow-id>`
 * on every subcommand (matching `task <task-id>` / `schedule <schedule-id>`);
 * the node id is `<node-id>` positional on node-scoped subcommands;
 * `add-edge` takes `--from-node-id` / `--to-node-id`;
 * `add-node` takes `--parent-node-ids` (csv plural).
 *
 * Flag-name choices for create / show / dag / cancel / rm:
 *  - `--brief` (not `--name`) for create -- matches
 *    `CreateWorkflowRequest.brief` on the wire and the
 *    `schedule create --brief` / `task dispatch --brief` precedent.
 *  - `--coord-agent` for the coordinator agent FQN, mapping to
 *    `CreateWorkflowRequest.coordinatorAgent`.
 *  - `--message` / `--kind` on cancel send the terminal payload
 *    (`cancellation: { kind, message }`).
 *  - `--summary` on finish (succeeded path) -> `success.output`.
 *    `--message` on finish (failed path) -> `failure.message`.
 *
 * Flag-name choices for the mutation commands:
 *  - `--kind <coordinator|worker>` for `add-node` / `add-subgraph`,
 *    matching the substrate's `NodeKind` (the wire alias is
 *    `WorkflowNodeKind`). Note: the existing dag-projection wire
 *    spells worker-kind as `"task"` for historical reasons (an early
 *    landing predates the kind rename); add/replace bodies use the
 *    substrate canonical names because they hit the un-projected
 *    write path.
 *  - `--spec-file <path>` (not inline `--spec`) for the opaque spec
 *    payload, because per-kind specs are routinely multi-line JSON
 *    (instructions, parents, etc) and shell-quoting is hostile. Same
 *    rationale as `catalog skill upsert --content-file`. No inline
 *    `--spec` overload is provided -- agents always write a temp file
 *    via the host filesystem.
 *  - `--parent-node-ids <ids>` on add-node is comma-separated; empty is
 *    rejected (substrate emits `EmptyParentsError` -> 400). On
 *    add-subgraph, intra-batch parents go in the spec file via the
 *    nodes[].existingParents array.
 *  - `--outcome <succeeded|failed>` on finish -- the only enum-typed
 *    flag; both values are accepted (cancellation is the separate
 *    `workflow cancel` route).
 *
 * Auth note: every mutation command requires the caller to be running as
 * a workflow's coordinator task (the substrate's `WorkflowMutation
 * UnauthorizedError` -> 403). A human at a terminal will get rejected
 * with a clear HTTP 403 + structured body; the CLI is here for
 * scripted use from a coord agent's task command line.
 */

export * from "./workflow/mutate.js";
export * from "./workflow/read.js";
export * from "./workflow/respond.js";
