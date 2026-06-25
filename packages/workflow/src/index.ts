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
 * `WorkflowCoordinatorNodeSpec`, `WorkflowNodeSpec`, …) are owned
 * by and imported directly from `@glyphs-ai/contracts`; the substrate
 * stays kind-agnostic and takes no workspace dep on the wire pkg.
 */

// ─── Stuck-recovery cap ─────────────────────────────────────────────
export { STUCK_RETRY_LIMIT, STUCK_RETRY_MAX_ATTEMPTS } from "./_stuck-recovery.js";
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
  AddEdgeOpts,
  AddEdgeResult,
  AddNodeOpts,
  AddNodeResult,
  AddSubgraphEdgeInput,
  AddSubgraphInsertedNode,
  AddSubgraphNodeInput,
  AddSubgraphOpts,
  AddSubgraphResult,
  CancelWorkflowOpts,
  CreateWorkflowOpts,
  CreateWorkflowResult,
  DispatchAtomicOpts,
  FinishWorkflowOpts,
  HumanNodeChoice,
  HumanNodePromptStyle,
  HumanNodeResponse,
  HumanNodeSpec,
  ListWorkflowOpts,
  NodeRef,
  RemoveEdgeOpts,
  ReplaceSpecOpts,
  WorkflowCancellation,
  WorkflowDagSnapshot,
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
  WorkflowOrigin,
  WorkflowRunners,
  WorkflowStatus,
  WorkflowSuccess,
} from "./types.js";
export {
  deriveIterationCount,
  HUMAN_MAX_CHOICES,
  HUMAN_PROMPT_STYLES,
  hasLiveCoord,
} from "./types.js";
// ─── Validators ─────────────────────────────────────────────────────
export {
  assertValidWorkflowId,
  assertValidWorkflowNodeId,
  assertValidWorkflowNodeKind,
  assertValidWorkflowNodeStatusEnum,
  assertValidWorkflowOriginEnum,
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
export { WorkflowService, type WorkflowServiceOpts } from "./workflow-service.js";
