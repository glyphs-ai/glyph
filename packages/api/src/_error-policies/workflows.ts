/**
 * Problem table for the workflows routes.
 *
 * @glyphs-ai/workflow is Result-native: use-cases return discriminated-union
 * error atoms (keyed on `type`). {@link WORKFLOW_ATOM_TABLE} maps each atom to
 * an HTTP status + `title`; per-occurrence `detail` builders reproduce the
 * interpolated message, and two atoms carry a from-state extension.
 *
 * ## `NodeSpecError` cause dispatch
 *
 * `NodeSpecError` wraps a `cause`. {@link respondWorkflowError} unwraps it:
 *  - a task use-case atom cause (e.g. `AgentNotFound`) resolves against the
 *    spread-in {@link TASK_TABLE}, exactly as a task route would render it;
 *  - a workflow spec-class cause (`WorkflowCoordSpecError`, …) resolves
 *    against {@link SPEC_CAUSE_TABLE} so its class `name` is the wire `code`;
 *  - any other cause falls back to the `NodeSpecError` row (`detail =
 *    err.reason`, `code = "NodeSpecError"`).
 *
 * ## Delete verb
 *
 * The delete route passes `transition: "delete"`; the
 * `WorkflowDeleteRequiresTerminal` row and a task `InvalidTransition` raised
 * during delete both read it into their `transition` extension.
 */

import type {
  AddWorkflowSubgraphError,
  AggregateWorkflowsByOriginError,
  CancelWorkflowError,
  CancelWorkflowNodeError,
  CountAwaitingHumanError,
  CreateWorkflowError,
  DeleteWorkflowError,
  FinishWorkflowError,
  GetWorkflowDagError,
  GetWorkflowError,
  GetWorkflowNodeError,
  ListWorkflowsError,
  NodeSpecError,
  RespondToHumanNodeError,
} from "@glyphs-ai/workflow";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  DomainProblemTable,
  ProblemDef,
  ProblemTable,
  RespondProblemOpts,
} from "../_http-errors.js";
import { readErrorCode, respondProblem } from "../_http-errors.js";
import type { WorkflowCoordAgentNotCapableError } from "../wiring/workflow-coord-task-runner.js";
import { TASK_TABLE } from "./tasks.js";

export type WorkflowRouteError =
  | AddWorkflowSubgraphError
  | AggregateWorkflowsByOriginError
  | CancelWorkflowError
  | CancelWorkflowNodeError
  | CountAwaitingHumanError
  | CreateWorkflowError
  | DeleteWorkflowError
  | FinishWorkflowError
  | GetWorkflowDagError
  | GetWorkflowError
  | GetWorkflowNodeError
  | ListWorkflowsError
  | RespondToHumanNodeError;

const INTERNAL = "internal error";

const WORKFLOW_ATOM_TABLE = {
  WorkflowNotFound: {
    status: 404,
    title: "Workflow not found",
    detail: (err) => `workflow not found: ${err.workflowId}`,
  },
  WorkflowNodeNotFound: {
    status: 404,
    title: "Workflow node not found",
    detail: (err) => `workflow node not found: ${err.nodeId}`,
  },
  NodeSpecError: {
    status: 422,
    title: "Node spec invalid",
    detail: (err) => err.reason,
  },
  EmptyParents: {
    status: 422,
    title: "Node must have a parent",
    detail: () => "node must have at least one parent",
  },
  WorkflowSubgraphInvalid: {
    status: 422,
    title: "Subgraph invalid",
    detail: (err) => {
      switch (err.reason.kind) {
        case "empty":
          return "subgraph must contain at least one node";
        case "tempIdInvalid":
          return err.reason.message;
        case "tempParentless":
          return `temp node has no parent: ${err.reason.tempId}`;
        case "nodeRefUnresolved":
          return `subgraph node ref unresolved: ${err.reason.refValue}`;
        case "cyclic":
          return "subgraph would create a cycle";
        case "multipleCoordTemps":
          return "subgraph contains multiple coordinator temp nodes";
      }
    },
    extension: (err) => ({ reason: err.reason }),
  },
  HumanNodeResponseInvalid: {
    status: 422,
    title: "Human node response invalid",
    detail: (err) => err.reason,
  },
  WorkflowAlreadyTerminal: {
    status: 409,
    title: "Workflow already terminal",
    detail: (err) => `workflow ${err.workflowId} is already terminal (${err.status})`,
  },
  WorkflowNodeNotMutable: {
    status: 409,
    title: "Workflow node not mutable",
    detail: (err) => `workflow node ${err.nodeId} is not mutable from ${err.status}`,
    extension: (err) => ({ fromStatus: err.status, transition: err.verb }),
  },
  WorkflowDeleteRequiresTerminal: {
    status: 409,
    title: "Workflow delete requires terminal state",
    detail: (err) =>
      `workflow ${err.workflowId} must be terminal before delete (current: ${err.status})`,
    extension: (err, opts) => ({
      fromStatus: err.status,
      transition: opts.transition ?? "delete",
    }),
  },
  WorkflowDagConflict: {
    status: 409,
    title: "Workflow DAG conflict",
    detail: (err) => {
      switch (err.reason.kind) {
        case "successorCoordExists":
          return "coordinator node already has a successor coordinator";
        case "orphanCoordInsert":
          return "coordinator insert would orphan the DAG frontier";
        case "parentState":
          return `parent ${err.reason.parentNodeId} is ${err.reason.parentStatus}; cannot attach ${err.reason.nodeKind}`;
        case "invariant":
          return "workflow DAG invariant violation";
      }
    },
    extension: (err) => ({ reason: err.reason }),
  },
  WorkflowInvariantViolation: { status: 500, title: "Internal error", detail: () => INTERNAL },
  DatabaseUnavailable: { status: 503, title: "Internal error", detail: () => INTERNAL },
  WorkflowDirReservationFailed: { status: 503, title: "Internal error", detail: () => INTERNAL },
} satisfies DomainProblemTable<WorkflowRouteError>;

/**
 * Rows for the spec-class causes a `NodeSpecError` can wrap. Keyed by the
 * class `name` (the wire `code`). These are semantic spec-validation
 * failures — the payload is well-formed but the agent spec is invalid or
 * the coordinator agent lacks the required capability — so they carry the
 * same 422 as the parent `NodeSpecError` row, and a client sees one status
 * for "bad node spec" whether or not a typed cause is attached.
 * `WorkflowWorkerNotInCoordMenuError` is the exception: its message would
 * enumerate the coordinator's dispatch menu (internal topology), so it
 * collapses to an opaque 500 (`detail = INTERNAL`) rather than presenting
 * as a caller-fixable 422 — but still exposes its `name` as `code` so a
 * client can branch.
 */
const SPEC_CAUSE_TABLE: Readonly<Record<string, ProblemDef>> = {
  WorkflowCoordAgentNotCapableError: {
    status: 422,
    title: "Coordinator agent not capable",
    detail: (err) => (err as unknown as WorkflowCoordAgentNotCapableError).message,
    extension: (err) => ({
      field: "coordinatorAgent",
      agent: (err as unknown as WorkflowCoordAgentNotCapableError).agentFqn,
    }),
  },
  WorkflowWorkerNotInCoordMenuError: {
    status: 500,
    title: "Internal error",
    detail: () => INTERNAL,
  },
  WorkflowCoordSpecError: {
    status: 422,
    title: "Coordinator spec invalid",
    detail: (err) => (err as unknown as Error).message,
  },
  WorkflowWorkerSpecError: {
    status: 422,
    title: "Worker spec invalid",
    detail: (err) => (err as unknown as Error).message,
  },
  WorkflowHumanSpecError: {
    status: 422,
    title: "Human node spec invalid",
    detail: (err) => (err as unknown as Error).message,
  },
};

/**
 * Merged workflow Problem table: workflow atoms + the shared {@link TASK_TABLE}
 * (a task use-case failure inside a node propagates as a raw task atom, or as
 * a `NodeSpecError` cause) + the spec-class cause rows.
 */
export const workflowsErrorPolicy: ProblemTable = {
  ...(TASK_TABLE as ProblemTable),
  ...(WORKFLOW_ATOM_TABLE as unknown as ProblemTable),
  ...SPEC_CAUSE_TABLE,
};

export interface RespondWorkflowErrorOpts {
  readonly route: string;
  /** Table to resolve against. Defaults to {@link workflowsErrorPolicy}. */
  readonly policy?: ProblemTable;
  readonly meta?: Record<string, unknown>;
  /** Status for an error with no matching row. Defaults to 400. */
  readonly defaultStatus?: ContentfulStatusCode;
  /** Verb for a delete-path `InvalidTransition` / `WorkflowDeleteRequiresTerminal`. */
  readonly transition?: string;
}

/**
 * Render a workflow route's error as an `application/problem+json` response.
 * A `NodeSpecError` is unwrapped to its `cause` when that cause has its own
 * table row (task atom or spec-class); otherwise the `NodeSpecError` itself
 * resolves. 5xx tech failures are logged + collapsed by `respondProblem`.
 */
export function respondWorkflowError(
  c: Context,
  err: unknown,
  opts: RespondWorkflowErrorOpts,
): Response {
  const table = opts.policy ?? workflowsErrorPolicy;
  const base: RespondProblemOpts = {
    route: opts.route,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    ...(opts.defaultStatus !== undefined ? { defaultStatus: opts.defaultStatus } : {}),
    ...(opts.transition !== undefined ? { transition: opts.transition } : {}),
  };
  if (isNodeSpecError(err)) {
    const causeCode = readErrorCode(err.cause);
    if (causeCode !== undefined && causeCode in table) {
      return respondProblem(c, err.cause, table, base);
    }
  }
  return respondProblem(c, err, table, base);
}

function isNodeSpecError(err: unknown): err is NodeSpecError {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: unknown }).type === "NodeSpecError"
  );
}
