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

// ─── Application: per-use-case wire contracts ──────────────────────
export {
  type AddWorkflowSubgraphError,
  type AddWorkflowSubgraphRequest,
  AddWorkflowSubgraphRequestSchema,
  type AddWorkflowSubgraphResponse,
  AddWorkflowSubgraphResponseSchema,
} from "./application/add-workflow-subgraph.js";
export {
  type AggregateWorkflowsByOriginError,
  type AggregateWorkflowsByOriginRequest,
  AggregateWorkflowsByOriginRequestSchema,
  type AggregateWorkflowsByOriginResponse,
  AggregateWorkflowsByOriginResponseSchema,
} from "./application/aggregate-workflows-by-origin.js";
export {
  type CancelWorkflowError,
  type CancelWorkflowRequest,
  CancelWorkflowRequestSchema,
  type CancelWorkflowResponse,
  CancelWorkflowResponseSchema,
} from "./application/cancel-workflow.js";
export {
  type CancelWorkflowNodeError,
  type CancelWorkflowNodeRequest,
  CancelWorkflowNodeRequestSchema,
  type CancelWorkflowNodeResponse,
  CancelWorkflowNodeResponseSchema,
} from "./application/cancel-workflow-node.js";
export {
  type CountAwaitingHumanError,
  type CountAwaitingHumanRequest,
  CountAwaitingHumanRequestSchema,
  type CountAwaitingHumanResponse,
  CountAwaitingHumanResponseSchema,
} from "./application/count-awaiting-human.js";
export {
  type CreateWorkflowError,
  type CreateWorkflowRequest,
  CreateWorkflowRequestSchema,
  type CreateWorkflowResponse,
  CreateWorkflowResponseSchema,
  type NodeSpecError,
} from "./application/create-workflow.js";
export {
  type DeleteWorkflowError,
  type DeleteWorkflowRequest,
  DeleteWorkflowRequestSchema,
  type DeleteWorkflowResponse,
  DeleteWorkflowResponseSchema,
  type WorkflowDeleteRequiresTerminal,
} from "./application/delete-workflow.js";
// ─── Application: engine and ports ─────────────────────────────────
export {
  type WorkflowDispatchCoordinator,
  WorkflowEngine,
  type WorkflowEngineOpts,
} from "./application/engine/workflow-engine.js";
export {
  type FinishWorkflowError,
  type FinishWorkflowRequest,
  FinishWorkflowRequestSchema,
  type FinishWorkflowResponse,
  FinishWorkflowResponseSchema,
} from "./application/finish-workflow.js";
export {
  type GetWorkflowError,
  type GetWorkflowRequest,
  GetWorkflowRequestSchema,
  type GetWorkflowResponse,
  GetWorkflowResponseSchema,
} from "./application/get-workflow.js";
export {
  type GetWorkflowDagError,
  type GetWorkflowDagRequest,
  GetWorkflowDagRequestSchema,
  type GetWorkflowDagResponse,
  GetWorkflowDagResponseSchema,
  type WorkflowDagSnapshot,
  type WorkflowEdgeView,
} from "./application/get-workflow-dag.js";
export {
  type GetWorkflowNodeError,
  type GetWorkflowNodeRequest,
  GetWorkflowNodeRequestSchema,
  type GetWorkflowNodeResponse,
  GetWorkflowNodeResponseSchema,
} from "./application/get-workflow-node.js";
export {
  type ListWorkflowArtifactsError,
  type ListWorkflowArtifactsRequest,
  ListWorkflowArtifactsRequestSchema,
  type ListWorkflowArtifactsResponse,
  ListWorkflowArtifactsResponseSchema,
  type WorkflowArtifactEntry,
} from "./application/list-workflow-artifacts.js";
export {
  type ListWorkflowsError,
  type ListWorkflowsRequest,
  ListWorkflowsRequestSchema,
  type ListWorkflowsResponse,
  ListWorkflowsResponseSchema,
} from "./application/list-workflows.js";
export {
  type RunnerFault,
  runnerFor,
  type WorkflowNodeArtifactListing,
  type WorkflowNodeDispatchOpts,
  type WorkflowNodeRunner,
  type WorkflowNodeTerminalResult,
  type WorkflowNodeValidateCtx,
  type WorkflowRunners,
} from "./application/ports/workflow-node-runner.js";
export {
  type ResolveWorkflowArtifactPathError,
  type ResolveWorkflowArtifactPathRequest,
  ResolveWorkflowArtifactPathRequestSchema,
  type ResolveWorkflowArtifactPathResponse,
  ResolveWorkflowArtifactPathResponseSchema,
  type WorkflowArtifactRef,
} from "./application/resolve-workflow-artifact-path.js";
export {
  type RespondToHumanNodeError,
  type RespondToHumanNodeRequest,
  RespondToHumanNodeRequestSchema,
  type RespondToHumanNodeResponse,
  RespondToHumanNodeResponseSchema,
} from "./application/respond-to-human-node.js";
// ─── Shared cross-use-case surface (re-exported from domain) ───────
export * from "./application/workflow-public.js";
// ─── Path helpers ──────────────────────────────────────────────────
export {
  WORKFLOW_SUBDIR,
  WorkflowSandbox,
  workflowDir,
  workflowRoot,
} from "./infrastructure/file/workflow-sandbox.js";
// ─── Composition root ──────────────────────────────────────────────
export {
  composeWorkflowModule,
  type Db,
  schema,
  type WorkflowModule,
  type WorkflowModuleOptions,
} from "./workflow-module.js";
