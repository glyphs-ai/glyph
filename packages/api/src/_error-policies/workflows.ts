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
  WorkflowDeleteRequiresTerminal,
} from "@glyphs-ai/workflow";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorPolicy, RespondErrorOpts } from "../_http-errors.js";
import { respondError } from "../_http-errors.js";
import { isTaskUnionError } from "../wiring/_task-operation-error.js";
import {
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
} from "../wiring/workflow-coord-task-runner.js";
import { WorkflowHumanSpecError } from "../wiring/workflow-human-node-runner.js";
import {
  WorkflowWorkerNotInCoordMenuError,
  WorkflowWorkerSpecError,
} from "../wiring/workflow-worker-task-runner.js";
import { opaqueWorkerNotInCoordMenuBody } from "./_shared-bodies.js";
import { type TaskRouteError, taskErrorWireBody, taskUnionCodeStatuses } from "./tasks.js";

type CodeStatusEntry = NonNullable<ErrorPolicy["codeStatuses"]>[number];

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

type WorkflowErrorType = WorkflowRouteError["type"];

const STATUS_BY_TYPE: Readonly<Record<WorkflowErrorType, ContentfulStatusCode>> = {
  WorkflowNotFound: 404,
  WorkflowNodeNotFound: 404,
  NodeSpecError: 400,
  EmptyParents: 400,
  WorkflowSubgraphEmpty: 400,
  WorkflowSubgraphTempIdInvalid: 400,
  WorkflowSubgraphTempParentless: 400,
  WorkflowSubgraphNodeRefUnresolved: 400,
  HumanNodeResponseInvalid: 400,
  WorkflowAlreadyTerminal: 409,
  WorkflowNodeNotMutable: 409,
  WorkflowDeleteRequiresTerminal: 409,
  MultipleSuccessorCoords: 409,
  OrphanCoordInsert: 409,
  ParentState: 409,
  WorkflowSubgraphCyclic: 409,
  WorkflowSubgraphMultipleCoordTemps: 409,
  DagInvariant: 409,
  WorkflowCorruption: 500,
  WorkflowEnumValueCorruption: 500,
  WorkflowNodeKindShape: 500,
  WorkflowNodeKindCorruption: 500,
  DatabaseUnavailable: 500,
  WorkflowDirReservationFailed: 500,
};

function workflowWireBody(err: WorkflowRouteError): Record<string, unknown> {
  switch (err.type) {
    case "WorkflowNotFound":
      return { error: `workflow not found: ${err.workflowId}`, code: err.type };
    case "WorkflowNodeNotFound":
      return { error: `workflow node not found: ${err.nodeId}`, code: err.type };
    case "NodeSpecError":
      return nodeSpecWireBody(err);
    case "EmptyParents":
      return { error: "node must have at least one parent", code: err.type };
    case "WorkflowSubgraphEmpty":
      return { error: "subgraph must contain at least one node", code: err.type };
    case "WorkflowSubgraphTempIdInvalid":
      return { error: err.reason, code: err.type };
    case "WorkflowSubgraphTempParentless":
      return { error: `temp node has no parent: ${err.tempId}`, code: err.type };
    case "WorkflowSubgraphNodeRefUnresolved":
      return { error: `subgraph node ref unresolved: ${err.refValue}`, code: err.type };
    case "HumanNodeResponseInvalid":
      return { error: err.reason, code: err.type };
    case "WorkflowAlreadyTerminal":
      return {
        error: `workflow ${err.workflowId} is already terminal (${err.status})`,
        code: err.type,
      };
    case "WorkflowNodeNotMutable":
      return {
        error: `workflow node ${err.nodeId} is not mutable from ${err.status}`,
        code: err.type,
        status: err.status,
        transition: err.verb,
      };
    case "WorkflowDeleteRequiresTerminal":
      return workflowDeleteRequiresTerminalBody(err);
    case "MultipleSuccessorCoords":
      return { error: "coordinator node already has a successor coordinator", code: err.type };
    case "OrphanCoordInsert":
      return { error: "coordinator insert would orphan the DAG frontier", code: err.type };
    case "ParentState":
      return {
        error: `parent ${err.parentNodeId} is ${err.parentStatus}; cannot attach ${err.nodeKind}`,
        code: err.type,
      };
    case "WorkflowSubgraphCyclic":
      return { error: "subgraph would create a cycle", code: err.type };
    case "WorkflowSubgraphMultipleCoordTemps":
      return { error: "subgraph contains multiple coordinator temp nodes", code: err.type };
    case "DagInvariant":
      return { error: "workflow DAG invariant violation", code: err.type };
    case "WorkflowCorruption":
    case "WorkflowEnumValueCorruption":
    case "WorkflowNodeKindShape":
    case "WorkflowNodeKindCorruption":
    case "DatabaseUnavailable":
    case "WorkflowDirReservationFailed":
      return { error: "internal error" };
  }
}

function nodeSpecWireBody(err: NodeSpecError): Record<string, unknown> {
  const cause = err.cause;
  if (cause instanceof WorkflowCoordAgentNotCapableError) {
    return {
      error: cause.message,
      code: cause.name,
      field: "coordinatorAgent",
      agent: cause.agentFqn,
    };
  }
  if (cause instanceof WorkflowWorkerNotInCoordMenuError) {
    return opaqueWorkerNotInCoordMenuBody(cause);
  }
  if (
    cause instanceof WorkflowCoordSpecError ||
    cause instanceof WorkflowWorkerSpecError ||
    cause instanceof WorkflowHumanSpecError
  ) {
    return { error: (cause as Error).message, code: cause.name };
  }
  return { error: err.reason, code: err.type };
}

function workflowDeleteRequiresTerminalBody(
  err: WorkflowDeleteRequiresTerminal,
): Record<string, unknown> {
  return {
    error: `workflow ${err.workflowId} must be terminal before delete (current: ${err.status})`,
    code: err.type,
    status: err.status,
    transition: "delete",
  };
}

function withCode(err: WorkflowRouteError): WorkflowRouteError & { readonly code: string } {
  return Object.assign(Object.create(null), err, { code: err.type });
}

function workflowCodeStatus(type: WorkflowErrorType): CodeStatusEntry {
  return [type, STATUS_BY_TYPE[type], (err) => workflowWireBody(err as WorkflowRouteError)];
}

export const workflowsErrorPolicy: ErrorPolicy = {
  name: "workflows",
  statuses: [],
  codeStatuses: [
    ...taskUnionCodeStatuses,
    ...(Object.keys(STATUS_BY_TYPE) as WorkflowErrorType[]).map(workflowCodeStatus),
  ],
};

export function respondWorkflowError(c: Context, err: unknown, opts: RespondErrorOpts): Response {
  if (!isWorkflowRouteError(err)) {
    return respondError(c, err, { ...opts, policy: workflowsErrorPolicy });
  }
  if (err.type === "NodeSpecError" && isTaskUnionError(err.cause)) {
    return respondError(c, err.cause, { ...opts, policy: workflowsErrorPolicy });
  }
  return respondError(c, withCode(err), { ...opts, policy: workflowsErrorPolicy });
}

export function workflowCustomDeleteBody(err: unknown): Record<string, unknown> | null {
  if (isWorkflowDeleteRequiresTerminal(err)) return workflowDeleteRequiresTerminalBody(err);
  if (isTaskUnionError(err) && err.type === "InvalidTransition") {
    return taskErrorWireBody(err as unknown as TaskRouteError, "delete");
  }
  return null;
}

function isWorkflowDeleteRequiresTerminal(err: unknown): err is WorkflowDeleteRequiresTerminal {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    err.type === "WorkflowDeleteRequiresTerminal"
  );
}

function isWorkflowRouteError(err: unknown): err is WorkflowRouteError {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof err.type === "string" &&
    err.type in STATUS_BY_TYPE
  );
}
