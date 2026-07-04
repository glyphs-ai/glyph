/** Public domain surface shared across workflow use-cases. */

export type { WorkflowEdgeCreateArgs } from "../domain/edge/workflow-edge-entity.js";
export { WorkflowEdgeEntity } from "../domain/edge/workflow-edge-entity.js";
export type {
  HumanNodeChoice,
  HumanNodePromptStyle,
  HumanNodeResponse,
  HumanNodeSpec,
} from "../domain/node/workflow-human-node.js";
export {
  HUMAN_MAX_CHOICES,
  HUMAN_PROMPT_STYLES,
  HumanNodeChoiceSchema,
  HumanNodePromptStyleSchema,
  HumanNodeResponseSchema,
  HumanNodeSpecSchema,
} from "../domain/node/workflow-human-node.js";
export type {
  WorkflowNodeCreateArgs,
  WorkflowNodeReconstituteArgs,
} from "../domain/node/workflow-node-entity.js";
export { WorkflowNodeEntity } from "../domain/node/workflow-node-entity.js";
export type { InvalidWorkflowNodeId, WorkflowNodeId } from "../domain/node/workflow-node-id.js";
export { generateWorkflowNodeId, WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
export type { WorkflowNodeKind } from "../domain/node/workflow-node-kind.js";
export {
  COORDINATOR_KIND,
  HUMAN_KIND,
  WORKER_KIND,
  WORKFLOW_NODE_KINDS,
  WorkflowNodeKindSchema,
} from "../domain/node/workflow-node-kind.js";
export type {
  WorkflowNodeRetryMetadata,
  WorkflowNodeRetryReason,
} from "../domain/node/workflow-node-retry.js";
export {
  extractWorkflowNodeRetryMetadata,
  WorkflowNodeRetryMetadataSchema,
  WorkflowNodeRetryReasonSchema,
} from "../domain/node/workflow-node-retry.js";
export type {
  TerminalWorkflowNodeStatus,
  WorkflowNodeStatus,
} from "../domain/node/workflow-node-status.js";
export {
  isTerminalWorkflowNodeStatus,
  TERMINAL_WORKFLOW_NODE_STATUSES,
  WorkflowNodeStatusSchema,
} from "../domain/node/workflow-node-status.js";
export type {
  WorkflowArtifactFile,
  WorkflowArtifactListingFailed,
} from "../domain/workflow/workflow-artifact.js";
export type { WorkflowBrief } from "../domain/workflow/workflow-brief.js";
export { WorkflowBriefSchema } from "../domain/workflow/workflow-brief.js";
export type { WorkflowCancellation } from "../domain/workflow/workflow-cancellation.js";
export { WorkflowCancellationSchema } from "../domain/workflow/workflow-cancellation.js";
export {
  computePhaseFromParents,
  structuralLeaves,
  wouldCreateCycle,
} from "../domain/workflow/workflow-dag.js";
export { parentsReadyForKind } from "../domain/workflow/workflow-dispatch-readiness.js";
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
} from "../domain/workflow/workflow-entity.js";
export {
  normalizeSubgraphInput,
  validateSubgraphShape,
  WorkflowEntity,
} from "../domain/workflow/workflow-entity.js";
export type {
  DagInvariant,
  EmptyParents,
  MultipleSuccessorCoords,
  OrphanCoordInsert,
  ParentState,
  SubgraphError,
  WorkflowNodeNotFound,
  WorkflowNodeNotMutable,
  WorkflowSubgraphCyclic,
  WorkflowSubgraphEmpty,
  WorkflowSubgraphMultipleCoordTemps,
  WorkflowSubgraphNodeRefUnresolved,
  WorkflowSubgraphTempIdInvalid,
  WorkflowSubgraphTempParentless,
} from "../domain/workflow/workflow-entity-errors.js";
export { workflowNodeNotMutable } from "../domain/workflow/workflow-entity-errors.js";
export type {
  WorkflowFailure,
  WorkflowSubstrateFailureReason,
} from "../domain/workflow/workflow-failure.js";
export {
  WorkflowFailureSchema,
  WorkflowSubstrateFailureReasonSchema,
} from "../domain/workflow/workflow-failure.js";
export type { InvalidWorkflowId, WorkflowId } from "../domain/workflow/workflow-id.js";
export { generateWorkflowId, WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
export type { WorkflowOrigin } from "../domain/workflow/workflow-origin.js";
export { WorkflowOriginSchema } from "../domain/workflow/workflow-origin.js";
export type {
  DatabaseUnavailable,
  WorkflowCorruption,
  WorkflowEntityCorruption,
  WorkflowEnumValueCorruption,
  WorkflowNodeKindCorruption,
  WorkflowNodeKindShape,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
export type { WorkflowStatus } from "../domain/workflow/workflow-status.js";
export { WorkflowStatusSchema } from "../domain/workflow/workflow-status.js";
export {
  classifyStuckReason,
  STUCK_RETRY_LIMIT,
  STUCK_RETRY_MAX_ATTEMPTS,
} from "../domain/workflow/workflow-stuck-recovery.js";
export type { WorkflowSuccess } from "../domain/workflow/workflow-success.js";
export { WorkflowSuccessSchema } from "../domain/workflow/workflow-success.js";
