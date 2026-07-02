import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";

/** A persisted scalar or payload shape is incompatible with the domain schema. */
export type WorkflowCorruption = {
  readonly type: "WorkflowCorruption";
  readonly field: string;
  readonly value: string;
  readonly allowed: readonly string[];
};

/** A persisted enum value is outside the current vocabulary. */
export type WorkflowEnumValueCorruption = {
  readonly type: "WorkflowEnumValueCorruption";
  readonly field: string;
  readonly value: string;
  readonly allowed: readonly string[];
};

/** A node kind value has the wrong scalar shape. */
export type WorkflowNodeKindShape = {
  readonly type: "WorkflowNodeKindShape";
  readonly value: unknown;
};

/** A string node kind is outside the closed substrate kind set. */
export type WorkflowNodeKindCorruption = {
  readonly type: "WorkflowNodeKindCorruption";
  readonly kind: string;
  readonly allowed: readonly WorkflowNodeKind[];
};

/** Corruption atoms emitted by workflow entity rehydration. */
export type WorkflowEntityCorruption =
  | WorkflowCorruption
  | WorkflowEnumValueCorruption
  | WorkflowNodeKindShape
  | WorkflowNodeKindCorruption;

export function workflowCorruption(
  field: string,
  value: unknown,
  allowed: readonly string[],
): WorkflowCorruption {
  return { type: "WorkflowCorruption", field, value: String(value), allowed };
}

export function workflowEnumValueCorruption(
  field: string,
  value: unknown,
  allowed: readonly string[],
): WorkflowEnumValueCorruption {
  return { type: "WorkflowEnumValueCorruption", field, value: String(value), allowed };
}
