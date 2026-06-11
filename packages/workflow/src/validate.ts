/**
 * Input validation for `@glyphs-ai/workflow`. Pure functions; no I/O.
 *
 * Scope is shape-only: id grammar (`<YYYYMMDD>-<8hex>` for workflow
 * ids, UUIDv4 for node ids) and enum-set membership for the entity
 * layer's round-trip checks.
 *
 * Cross-kind contracts (e.g. "a worker's `agent` must appear in caller
 * coord's `dependencies.agents`") live in the kind runners, not
 * here, because they need access to the catalog and the caller-coord
 * spec.
 *
 * Substrate invariants (e.g. "this node id already exists") live in
 * the engine, not here, because they need a DB read.
 *
 * Convention: validators THROW (`assertValidXxx`) so callers can use
 * TypeScript's `asserts ... is string` narrowing.
 */

import { randomBytes as cryptoRandomBytes, randomUUID } from "node:crypto";
import {
  InvalidWorkflowIdError,
  InvalidWorkflowNodeIdError,
  WorkflowEnumValueCorruptionError,
  WorkflowError,
  WorkflowNodeKindCorruptionError,
  WorkflowNodeKindShapeError,
} from "./errors.js";
import type {
  WorkflowCancellation,
  WorkflowFailure,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowStatus,
  WorkflowSubstrateFailureReason,
  WorkflowSuccess,
} from "./types.js";

// ─── Id grammars ────────────────────────────────────────────────────

// UUID v4. Same shape `crypto.randomUUID()` produces. Node ids are
// UUIDv4 only.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `<YYYYMMDD>-<8 hex>` shape mirrored from `@glyphs-ai/task` for
// workflow ids. Lowercase hex only — the regex has no `/i` flag —
// matching `@glyphs-ai/task`'s `TASK_ID_RE`. Node ids never appear
// in `ls` output (they live inside their workflow
// dir, not at top-level), so the date-prefix's at-a-glance grouping
// benefit doesn't apply there — node ids stay UUIDv4 only.
const WORKFLOW_ID_RE = /^\d{8}-[0-9a-f]{8}$/;

/**
 * Workflow id grammar — `<YYYYMMDD>-<8 hex>`.
 */
export function assertValidWorkflowId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !WORKFLOW_ID_RE.test(id)) {
    throw new InvalidWorkflowIdError(String(id));
  }
}

/**
 * Workflow node id grammar — UUIDv4 only. No dated-hex shape support:
 * see the file-level note on why node ids don't need a date prefix.
 */
export function assertValidWorkflowNodeId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_V4_RE.test(id)) {
    throw new InvalidWorkflowNodeIdError(String(id));
  }
}

/**
 * Workflow id generator. Returns `<YYYYMMDD>-<8 lowercase hex>` — UTC
 * date prefix for at-a-glance grouping in `ls` output, ~4B-id-per-day
 * collision space from the 4 random bytes. Mirrors
 * `@glyphs-ai/task`'s `generateTaskId` so operators see a consistent
 * id pattern across both surfaces.
 *
 * `now` and `randomBytes` are injectable seams so tests can produce
 * deterministic ids by stubbing both.
 */
export function generateWorkflowId(
  now: () => Date = () => new Date(),
  randomBytes: (n: number) => Buffer = cryptoRandomBytes,
): string {
  const d = now();
  const date = pad4(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
  const suffix = randomBytes(4).toString("hex");
  return `${date}-${suffix}`;
}

/** UUIDv4 generator for new workflow nodes. */
export function generateWorkflowNodeId(randomUUIDFn: () => string = randomUUID): string {
  return randomUUIDFn();
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

// ─── Enum-set checks (used by entity round-trip; throw on miss) ─────

const VALID_WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

const VALID_NODE_STATUSES: readonly WorkflowNodeStatus[] = [
  "not_started",
  "ready",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

/**
 * Enum-membership check for `workflow.status`. Throws
 * {@link WorkflowEnumValueCorruptionError} on miss — used by
 * `WorkflowEntity.fromRow` to reject corrupted / hand-edited rows.
 */
export function assertValidWorkflowStatusEnum(status: unknown): asserts status is WorkflowStatus {
  if (
    typeof status !== "string" ||
    !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(status)
  ) {
    throw new WorkflowEnumValueCorruptionError("status", String(status), VALID_WORKFLOW_STATUSES);
  }
}

/**
 * Enum-membership check for `workflow_nodes.status`. Throws
 * {@link WorkflowEnumValueCorruptionError} on miss — used by
 * `WorkflowNodeEntity.fromRow` to reject corrupted rows.
 */
export function assertValidWorkflowNodeStatusEnum(
  status: unknown,
): asserts status is WorkflowNodeStatus {
  if (typeof status !== "string" || !(VALID_NODE_STATUSES as readonly string[]).includes(status)) {
    throw new WorkflowEnumValueCorruptionError("status", String(status), VALID_NODE_STATUSES);
  }
}

/**
 * Closed-set check for `workflow_nodes.kind`. Non-string / empty
 * values are shape errors; unknown string values are row corruption.
 * Used by `WorkflowNodeEntity.fromRow` so the typed entity field can
 * carry the closed-enum type directly.
 */
export function assertValidWorkflowNodeKind(kind: unknown): asserts kind is WorkflowNodeKind {
  if (typeof kind !== "string" || kind.length === 0) {
    throw new WorkflowNodeKindShapeError(String(kind));
  }
  if (kind !== "coordinator" && kind !== "worker") {
    throw new WorkflowNodeKindCorruptionError(kind);
  }
}

// ─── Terminal-payload shape validators ──────────────────────────────

const FAILURE_KINDS = new Set(["coordinator", "substrate"]);
const SUBSTRATE_FAILURE_REASONS: ReadonlySet<WorkflowSubstrateFailureReason> =
  new Set<WorkflowSubstrateFailureReason>(["STUCK_RETRY_LIMIT"]);
const CANCELLATION_KINDS = new Set(["user"]);

/**
 * Shape check for {@link WorkflowSuccess}. Used by
 * `WorkflowEntity.fromRow` when the `success` column is non-null.
 * Throws `WorkflowError` on miss.
 */
export function assertWorkflowSuccessShape(id: string, value: WorkflowSuccess): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(`Workflow "${id}" corrupted: success must be an object`);
  }
  const v = value as { output?: unknown };
  if (v.output !== null && typeof v.output !== "string") {
    throw new WorkflowError(`Workflow "${id}" corrupted: success.output must be a string or null`);
  }
}

/**
 * Shape check for {@link WorkflowFailure}. Used by
 * `WorkflowEntity.fromRow` when the `failure` column is non-null.
 * Throws `WorkflowError` on miss.
 */
export function assertWorkflowFailureShape(id: string, value: WorkflowFailure): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(`Workflow "${id}" corrupted: failure must be an object`);
  }
  const v = value as { kind?: unknown; message?: unknown; reason?: unknown };
  if (typeof v.kind !== "string" || !FAILURE_KINDS.has(v.kind)) {
    throw new WorkflowError(
      `Workflow "${id}" corrupted: failure.kind must be one of: ${[...FAILURE_KINDS].join(", ")}`,
    );
  }
  if (typeof v.message !== "string") {
    throw new WorkflowError(`Workflow "${id}" corrupted: failure.message must be a string`);
  }
  if (v.kind === "substrate") {
    if (
      typeof v.reason !== "string" ||
      !(SUBSTRATE_FAILURE_REASONS as ReadonlySet<string>).has(v.reason)
    ) {
      throw new WorkflowError(
        `Workflow "${id}" corrupted: failure.reason must be one of: ${[...SUBSTRATE_FAILURE_REASONS].join(", ")}`,
      );
    }
  }
}

/**
 * Shape check for {@link WorkflowCancellation}. Used by
 * `WorkflowEntity.fromRow` when the `cancellation` column is
 * non-null. Throws `WorkflowError` on miss.
 */
export function assertWorkflowCancellationShape(id: string, value: WorkflowCancellation): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(`Workflow "${id}" corrupted: cancellation must be an object`);
  }
  const v = value as { kind?: unknown; message?: unknown };
  if (typeof v.kind !== "string" || !CANCELLATION_KINDS.has(v.kind)) {
    throw new WorkflowError(
      `Workflow "${id}" corrupted: cancellation.kind must be one of: ${[...CANCELLATION_KINDS].join(", ")}`,
    );
  }
  if (typeof v.message !== "string") {
    throw new WorkflowError(`Workflow "${id}" corrupted: cancellation.message must be a string`);
  }
}
