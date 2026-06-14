/**
 * Public API of `@glyphs-ai/workflow`.
 *
 * A closed-kind substrate for a workflow DAG with mutation primitives.
 * The pkg owns three tables (`workflows` / `workflow_nodes` /
 * `workflow_edges`), the entity layer that round-trips them, the
 * error catalog, and the `WorkflowNodeRunner` interface that callers
 * implement once per `WorkflowNodeKind` and inject at compose time via the
 * `runners: WorkflowRunners` field on {@link composeWorkflowModule}.
 *
 * Construction goes through `composeWorkflowModule({ dbFile, …,
 * runners })`. Tests use `openTestWorkflowDb()` from `./testing`.
 *
 * Per-kind wire DTOs (`WorkflowWorkerNodeSpec`,
 * `WorkflowCoordinatorNodeSpec`, `WorkflowNodeWireSpec`, …) are owned
 * by and imported directly from `@glyphs-ai/contracts`; the substrate
 * stays kind-agnostic and takes no workspace dep on the wire pkg.
 */

// ─── Substrate types ────────────────────────────────────────────────
export type { NodeRef } from "./_dag.js";
// ─── Composition ────────────────────────────────────────────────────
export {
  composeWorkflowModule,
  type WorkflowModule,
  type WorkflowModuleOptions,
} from "./compose.js";
// ─── Errors ─────────────────────────────────────────────────────────
export {
  EmptyParentsError,
  InvalidWorkflowIdError,
  InvalidWorkflowNodeIdError,
  MultipleSuccessorCoordsError,
  OrphanCoordInsertError,
  ParentStateError,
  WorkflowAlreadyTerminalError,
  WorkflowDagInvariantError,
  WorkflowDeleteRequiresTerminalError,
  WorkflowEdgeCycleError,
  WorkflowEdgeNotFoundError,
  WorkflowEnumValueCorruptionError,
  WorkflowError,
  WorkflowNodeKindCorruptionError,
  WorkflowNodeKindShapeError,
  WorkflowNodeNotFoundError,
  WorkflowNodeNotMutableError,
  WorkflowNodeSpecError,
  WorkflowNotFoundError,
  WorkflowRemoveEdgeOrphansChildError,
  WorkflowRemoveNodeOrphansChildError,
  WorkflowSubgraphCyclicError,
  WorkflowSubgraphEmptyError,
  WorkflowSubgraphMultipleCoordTempsError,
  WorkflowSubgraphNodeRefUnresolvedError,
  WorkflowSubgraphTempIdInvalidError,
  WorkflowSubgraphTempParentlessError,
} from "./errors.js";
// ─── Path helpers ───────────────────────────────────────────────────
export {
  WORKFLOW_NODES_SUBDIR,
  WORKFLOW_SUBDIR,
  workflowDir,
  workflowNodeDir,
  workflowRoot,
} from "./paths.js";
// ─── Re-exported types ──────────────────────────────────────────────
export type {
  HumanNodeChoice,
  HumanNodeResponse,
  HumanNodeSpec,
  WorkflowCancellation,
  WorkflowFailure,
  WorkflowNodeDispatchOpts,
  WorkflowNodeKind,
  WorkflowNodeRetryMetadata,
  WorkflowNodeRetryReason,
  WorkflowNodeRunner,
  WorkflowNodeSpecEnvelope,
  WorkflowNodeStatus,
  WorkflowNodeTerminalResult,
  WorkflowNodeValidateCtx,
  WorkflowRunners,
  WorkflowStatus,
  WorkflowSubstrateFailureReason,
  WorkflowSuccess,
} from "./types.js";
export {
  deriveIterationCount,
  HUMAN_MAX_CHOICES,
  hasLiveCoord,
} from "./types.js";
// ─── Validators ─────────────────────────────────────────────────────
export {
  assertValidWorkflowId,
  assertValidWorkflowNodeId,
  assertValidWorkflowNodeKind,
  assertValidWorkflowNodeStatusEnum,
  assertValidWorkflowStatusEnum,
  generateWorkflowId,
  generateWorkflowNodeId,
} from "./validate.js";
// ─── Entity classes ─────────────────────────────────────────────────
export {
  extractWorkflowNodeRetryMetadata,
  WorkflowEdgeEntity,
  WorkflowEntity,
  WorkflowNodeEntity,
} from "./workflow-entity.js";
// ─── Service ────────────────────────────────────────────────────────
export {
  type AddEdgeOpts,
  type AddEdgeResult,
  type AddNodeOpts,
  type AddNodeResult,
  type AddSubgraphEdgeInput,
  type AddSubgraphInsertedNode,
  type AddSubgraphNodeInput,
  type AddSubgraphOpts,
  type AddSubgraphResult,
  type CancelWorkflowOpts,
  type CreateWorkflowOpts,
  type CreateWorkflowResult,
  type DispatchAtomicOpts,
  type FinishWorkflowOpts,
  type ListWorkflowOpts,
  type RemoveEdgeOpts,
  type ReplaceSpecOpts,
  STUCK_RETRY_LIMIT,
  STUCK_RETRY_MAX_ATTEMPTS,
  type WorkflowDagSnapshot,
  WorkflowService,
  type WorkflowServiceOpts,
} from "./workflow-service.js";
