/**
 * Per-domain error policy for the workflows routes.
 *
 * Source of truth for the (class, status) pairs is the workflow
 * substrate's error catalog in `packages/workflow/src/errors.ts`.
 *
 * Status assignments:
 *
 *   - 400 — caller-fixable structural validation. Note: the
 *           defensive enum / kind guards
 *           (`WorkflowNodeKindCorruptionError`,
 *           `WorkflowEnumValueCorruptionError`) are deliberately
 *           NOT listed here: they signal that a persisted row or
 *           internal lookup carried a value outside the closed enum,
 *           which is schema corruption and maps to 500. The
 *           caller-input shape guard for kind
 *           (`WorkflowNodeKindShapeError`) is the legitimate 400
 *           bucket for kind validation.
 *   - 404 — addressing miss (workflow / node / edge not in this
 *           workspace).
 *   - 409 — CAS / FSM / DAG conflict against existing state (workflow
 *           already terminal, node not mutable at the requested verb,
 *           edge would close a cycle, remove would orphan a child,
 *           etc.). The substrate emits these AFTER the row exists —
 *           the caller observed a stale state.
 *
 * Agent-resolution failures from the coord-kind runner's `validate`
 * surface through task union values (`AgentNotFound` /
 * `AgentResolutionFailed`) and are covered by `codeStatuses` below.
 * They are reachable via `POST /workflows` at create time AND via the
 * DAG-mutation routes (`addNode`, `addSubgraph`, `replaceNodeSpec`)
 * when the runner re-validates an agent FQN.
 *
 * Coord-runner validate-time capability rejection
 * (`WorkflowCoordAgentNotCapableError`) is listed below with a stable
 * body builder that pins the rejection to the `coordinatorAgent` form
 * field, matching the task `EntryNotReady` union envelope shape.
 */

import {
  taskUnionCodeStatuses,
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
  WorkflowHumanSpecError,
  WorkflowWorkerNotInCoordMenuError,
  WorkflowWorkerSpecError,
} from "@glyphs-ai/api";
import {
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
} from "@glyphs-ai/workflow";
import type { ErrorPolicy } from "../_respond-error.js";
import { opaqueWorkerNotInCoordMenuBody } from "./_shared-bodies.js";

export const workflowsErrorPolicy: ErrorPolicy = {
  name: "workflows",
  statuses: [
    // 404 — addressing miss
    [WorkflowNotFoundError, 404],
    [WorkflowNodeNotFoundError, 404],
    [WorkflowEdgeNotFoundError, 404],

    // 400 — caller-fixable structural validation
    [InvalidWorkflowIdError, 400],
    [InvalidWorkflowNodeIdError, 400],
    [WorkflowNodeSpecError, 400],
    [EmptyParentsError, 400],
    [WorkflowSubgraphEmptyError, 400],
    [WorkflowSubgraphTempIdInvalidError, 400],
    [WorkflowSubgraphTempParentlessError, 400],
    [WorkflowSubgraphNodeRefUnresolvedError, 400],
    // The shape guard for `kind` fires on caller input — `kind` must
    // be a non-empty string before the substrate even tries to map
    // it to a runner. Honest 400.
    [WorkflowNodeKindShapeError, 400],
    // Coord-runner capability rejection — the requested coordinator
    // agent's catalog frontmatter declares no `dependencies.agents`
    // dispatch menu. Caller-fixable: pick a different agent (or add
    // the menu to the existing one). Body pins the error to the
    // form field so the dashboard can render it inline. Matches the
    // task `EntryNotReady` union envelope shape.
    [
      WorkflowCoordAgentNotCapableError,
      400,
      (err) => {
        const e = err as WorkflowCoordAgentNotCapableError;
        return {
          error: e.message,
          code: e.name,
          field: "coordinatorAgent",
          agent: e.agentFqn,
        };
      },
    ],
    // Coord-runner strict-shape rejection — the coord node spec is
    // not an object, has a missing/empty `agent`, or carries an
    // unknown key. Reachable from `POST /workflows` AND from
    // DAG-mutation routes (`addNode` / `addSubgraph` /
    // `replaceNodeSpec`). The message templates are safe by
    // construction, so the default `errorBody` builder is sufficient.
    [WorkflowCoordSpecError, 400],
    // Worker-runner spec-shape rejection. Same safe-message rule as
    // WorkflowCoordSpecError, but for worker-kind nodes.
    [WorkflowWorkerSpecError, 400],
    // Human-runner strict-shape rejection — non-object spec, missing /
    // empty `prompt`, invalid `promptStyle`, or malformed `choices`.
    // Same safe-by-construction message rule as the coord / worker spec
    // errors; keeps the three node runners isomorphic. It subclasses
    // `WorkflowError`, so the catch-all entry below would also map it to
    // 400 — listed explicitly so the policy reads as the source of truth.
    [WorkflowHumanSpecError, 400],
    // Worker-runner menu-membership rejection — the worker node's
    // `spec.agent` is not in the coordinator's `dependencies.agents`
    // dispatch menu. Caller-fixable (400), but the message enumerates
    // the coordinator's full menu (internal workflow topology), so the
    // wire body is collapsed to an opaque `{ error, code }` envelope.
    // Routed by instanceof here rather than the `INTERNAL_ERROR_NAMES`
    // string-match (retained as defense-in-depth) so a class/`.name`
    // drift can't silently break the opaque routing.
    [WorkflowWorkerNotInCoordMenuError, 400, opaqueWorkerNotInCoordMenuBody],

    // 500 — defensive guards that fire only when a persisted row or
    // internal lookup carries a value outside the closed enum. These
    // signal schema corruption / older-binary-leftover rows, NOT
    // caller mistakes; the response body is an opaque sanitized
    // string at the respond-error layer (see SAFE_ERROR_NAMES).
    [WorkflowNodeKindCorruptionError, 500],
    [WorkflowEnumValueCorruptionError, 500],

    // 409 — FSM / DAG conflict against existing state
    [WorkflowAlreadyTerminalError, 409],
    [WorkflowNodeNotMutableError, 409],
    // Delete-while-running. The route attaches a customBody to surface
    // `{ code, status, transition: 'delete' }` so the dashboard
    // branches on `transition` to render a "Cancel first" CTA — the
    // same envelope precedent as task's InvalidTransition + delete
    // verb.
    [WorkflowDeleteRequiresTerminalError, 409],
    [WorkflowEdgeCycleError, 409],
    [MultipleSuccessorCoordsError, 409],
    [OrphanCoordInsertError, 409],
    [ParentStateError, 409],
    [WorkflowRemoveNodeOrphansChildError, 409],
    [WorkflowRemoveEdgeOrphansChildError, 409],
    [WorkflowSubgraphCyclicError, 409],
    [WorkflowSubgraphMultipleCoordTempsError, 409],
    // §3 leaf-frontier invariant — `addSubgraph` batch produced 0,
    // 2+, or worker-only leaves. Caller observed a stale DAG state
    // and submitted a batch that would have left the workflow
    // structurally stuck. 409 because it's a state-conflict against
    // the substrate's well-formedness rules.
    [WorkflowDagInvariantError, 409],

    // `WorkflowError` is the abstract base — listed LAST so concrete
    // subclasses match first. Defaults to 400 (most workflow-base
    // throws are caller validation flavors).
    [WorkflowError, 400],
  ],
  // Task-dispatch failures inside worker / coord node runs surface as a
  // `TaskOperationError` carrying the task union `type` as `.code`;
  // resolve their status + body from the shared task-error table so the
  // wire `code` matches the task routes.
  codeStatuses: [...taskUnionCodeStatuses],
};
