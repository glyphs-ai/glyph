/**
 * Public API of `@glyphs-ai/workflow`.
 *
 * A closed-kind substrate for a workflow DAG. The package owns three tables
 * (`workflows` / `workflow_nodes` / `workflow_edges`), a Result-native
 * four-layer stack (domain / infrastructure / application / composition), and
 * the `WorkflowNodeRunner` port that callers implement once per
 * `WorkflowNodeKind` and inject at compose time via the `runners` field on
 * {@link composeWorkflowModule}.
 *
 * Construction goes through `composeWorkflowModule({ dbFile | db, workspaceDir,
 * runners })`, which returns a {@link WorkflowModule} — a DI container of
 * use-case instances plus the stateful engine. There is no service facade;
 * consumers call `module.<useCase>.execute(request)`.
 *
 * Per-kind wire DTOs (e.g. worker/coordinator node specs) are owned by and
 * imported directly from `@glyphs-ai/api`'s wire surface; the substrate stays
 * kind-agnostic and takes no dependency on the wire layer.
 */

// ─── Application: use-cases, engine, ports, ids ──────────────────────
export * from "./application/index.js";
export * from "./domain/edge/workflow-edge-entity.js";
export * from "./domain/node/workflow-human-node.js";
export * from "./domain/node/workflow-node-entity.js";
export * from "./domain/node/workflow-node-kind.js";
export * from "./domain/node/workflow-node-retry.js";
export * from "./domain/node/workflow-node-status.js";
export * from "./domain/workflow/workflow-cancellation.js";
export * from "./domain/workflow/workflow-corruption.js";
export * from "./domain/workflow/workflow-dag.js";
export * from "./domain/workflow/workflow-dispatch-readiness.js";
export type {
  IllegalNodeTransition,
  NodeRef,
  NormalizedSubgraphInput,
  SubgraphEdgeShape,
  SubgraphNodeInput,
  SubgraphTempNodeShape,
  WorkflowAlreadyTerminal,
  WorkflowCreateArgs,
  WorkflowHeaderSnapshot,
  WorkflowNodeSnapshot,
  WorkflowReconstituteArgs,
  WorkflowSnapshot,
} from "./domain/workflow/workflow-entity.js";
// ─── Domain: entities, value objects, error atoms (ids come via the
//     application barrel) ──
export {
  normalizeSubgraphInput,
  validateSubgraphShape,
  WorkflowEntity,
} from "./domain/workflow/workflow-entity.js";
export * from "./domain/workflow/workflow-errors.js";
export * from "./domain/workflow/workflow-failure.js";
export * from "./domain/workflow/workflow-origin.js";
export type {
  DatabaseUnavailable,
  WorkflowEdgeNotFound,
  WorkflowNodeNotFound,
  WorkflowNotFound,
  WorkflowRepository,
} from "./domain/workflow/workflow-repository.js";
export * from "./domain/workflow/workflow-status.js";
export * from "./domain/workflow/workflow-stuck-recovery.js";
export * from "./domain/workflow/workflow-success.js";
// ─── Path helpers ───────────────────────────────────────────────────
export * from "./infrastructure/file/workflow-sandbox.js";
// ─── Composition ────────────────────────────────────────────────────
export * from "./workflow-module.js";
