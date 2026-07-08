/**
 * Shared fixtures for the application-layer workflow tests: stub kind runners
 * plus a composed {@link WorkflowModule} over an in-memory SQLite and a real
 * tmp-dir workspace. File name does not end in `.test.ts`, so vitest never runs
 * it as a suite.
 *
 * The stub runners implement `WorkflowNodeRunner`:
 *   - `validate` is identity-by-default; tests swap `validateReturnValue` /
 *     `validateShouldThrow` to assert call args or simulate validate failures.
 *   - `dispatch` records the call (including the engine-supplied `onTerminal`
 *     callback) and returns ok; the node stays `running` until the test
 *     drives termination by invoking the captured `onTerminal`. Setting
 *     `dispatchShouldThrow` makes the next dispatch err.
 *   - `hasInFlightForNode` reads from `inFlightSet` (defaults to `false`).
 *   - `cancel` records calls; errs when `cancelShouldThrow` is set (lets
 *     tests prove the substrate still marks the node cancelled even if the
 *     runner fails).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import type { Logger } from "pino";
import pino from "pino";
import type {
  WorkflowNodeArtifactListing,
  WorkflowNodeDispatchOpts,
  WorkflowNodeRunner,
  WorkflowNodeTerminalResult,
  WorkflowNodeValidateCtx,
  WorkflowRunners,
} from "../../src/application/ports/workflow-node-runner.js";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../src/domain/node/workflow-node-id.js";
import type { WorkflowNodeKind } from "../../src/domain/node/workflow-node-kind.js";
import type { WorkflowNodeStatus } from "../../src/domain/node/workflow-node-status.js";
import { type WorkflowId, WorkflowIdSchema } from "../../src/domain/workflow/workflow-id.js";
import type { Db } from "../../src/infrastructure/drizzle/workflow-db.js";
import { workflowNodes } from "../../src/infrastructure/drizzle/workflow-schema.js";
import { workflowRoot } from "../../src/infrastructure/file/workflow-sandbox.js";
import { composeWorkflowModule, type WorkflowModule } from "../../src/workflow-module.js";
import { openTestDb } from "../testing.js";

export interface ValidateCall {
  readonly spec: unknown;
  readonly ctx: WorkflowNodeValidateCtx;
}

export interface DispatchCall {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly spec: unknown;
  /** The engine-threaded terminal callback; tests invoke it to drive the node terminal. */
  readonly onTerminal: (result: WorkflowNodeTerminalResult) => void;
}

export interface StubRunner extends WorkflowNodeRunner {
  readonly validateCalls: ValidateCall[];
  readonly dispatchCalls: DispatchCall[];
  readonly cancelCalls: string[];
  readonly artifactListings: Map<string, WorkflowNodeArtifactListing | null>;
  readonly artifactPaths: Map<string, string | null>;
  /** Nodes considered to have in-flight units. */
  readonly inFlightSet: Set<string>;
  /** When true, the next dispatch call throws. */
  dispatchShouldThrow: boolean;
  /** When true, the next cancel call throws. */
  cancelShouldThrow: boolean;
  /** Override the `validate` return value; defaults to identity. */
  validateReturnValue: unknown | undefined;
  /** Override the `validate` behavior to throw. */
  validateShouldThrow: Error | null;
}

export function makeStubRunner(): StubRunner {
  const validateCalls: ValidateCall[] = [];
  const dispatchCalls: DispatchCall[] = [];
  const cancelCalls: string[] = [];
  const artifactListings = new Map<string, WorkflowNodeArtifactListing | null>();
  const artifactPaths = new Map<string, string | null>();
  const inFlightSet = new Set<string>();
  const stub: StubRunner = {
    validateCalls,
    dispatchCalls,
    cancelCalls,
    artifactListings,
    artifactPaths,
    inFlightSet,
    dispatchShouldThrow: false,
    cancelShouldThrow: false,
    validateReturnValue: undefined,
    validateShouldThrow: null,
    validate(spec, ctx) {
      validateCalls.push({ spec, ctx });
      if (stub.validateShouldThrow !== null) return errAsync({ cause: stub.validateShouldThrow });
      return okAsync(stub.validateReturnValue !== undefined ? stub.validateReturnValue : spec);
    },
    dispatch(opts: WorkflowNodeDispatchOpts) {
      dispatchCalls.push({
        workflowId: opts.workflowId,
        nodeId: opts.nodeId,
        spec: opts.spec,
        onTerminal: opts.onTerminal,
      });
      if (stub.dispatchShouldThrow) {
        stub.dispatchShouldThrow = false;
        return errAsync({ cause: new Error("stub dispatch failure") });
      }
      return okAsync(undefined);
    },
    hasInFlightForNode(nodeId) {
      return okAsync(inFlightSet.has(nodeId));
    },
    cancel(nodeId) {
      cancelCalls.push(nodeId);
      if (stub.cancelShouldThrow) {
        stub.cancelShouldThrow = false;
        return errAsync({ cause: new Error("stub cancel failure") });
      }
      return okAsync(undefined);
    },
    listArtifacts(nodeId) {
      return okAsync(artifactListings.get(nodeId) ?? null);
    },
    resolveArtifactPath(nodeId, name) {
      return okAsync(artifactPaths.get(`${nodeId}:${name}`) ?? null);
    },
  };
  return stub;
}

export interface WorkflowFixture {
  readonly module: WorkflowModule;
  readonly coordRunner: StubRunner;
  readonly workerRunner: StubRunner;
  readonly humanRunner: StubRunner;
  readonly db: Db;
  readonly workspaceDir: string;
  readonly nowRef: { value: Date };
  setNow(d: Date): void;
  close(): Promise<void>;
}

export async function buildWorkflowFixture(
  opts: {
    readonly initialNow?: Date;
    readonly randomUUID?: () => string;
    readonly randomBytes?: (n: number) => Buffer;
    readonly logger?: Logger;
    readonly coordRunner?: StubRunner;
    readonly workerRunner?: StubRunner;
    readonly humanRunner?: StubRunner;
  } = {},
): Promise<WorkflowFixture> {
  const { db, close: closeDb } = await openTestDb(":memory:");
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "wf-test-"));
  // Mirror @glyphs-ai/workspace's `register` provisioning step: create the
  // `workflows/` parent that `WorkflowSandbox.reserve` assumes exists (it
  // does `mkdir` of the leaf with `{recursive: false}`).
  mkdirSync(workflowRoot(workspaceDir));
  const coordRunner = opts.coordRunner ?? makeStubRunner();
  const workerRunner = opts.workerRunner ?? makeStubRunner();
  const humanRunner = opts.humanRunner ?? makeStubRunner();
  const runners: WorkflowRunners = {
    coordinator: coordRunner,
    worker: workerRunner,
    human: humanRunner,
  };
  const nowRef = { value: opts.initialNow ?? new Date("2026-06-07T00:00:00.000Z") };
  const logger = opts.logger ?? pino({ level: "silent" });
  const module = await composeWorkflowModule({
    db,
    workspaceDir,
    runners,
    logger,
    now: () => nowRef.value,
    ...(opts.randomUUID !== undefined ? { randomUUID: opts.randomUUID } : {}),
    ...(opts.randomBytes !== undefined ? { randomBytes: opts.randomBytes } : {}),
  });
  return {
    module,
    coordRunner,
    workerRunner,
    humanRunner,
    db,
    workspaceDir,
    nowRef,
    setNow(d) {
      nowRef.value = d;
    },
    async close() {
      await module.close();
      closeDb();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

/**
 * Sequence generator that yields a fixed list of UUIDs in order. Throws when
 * exhausted so tests fail loudly instead of accidentally minting random ids.
 */
export function fixedRandomUUID(ids: readonly string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i];
    if (id === undefined) throw new Error("fixedRandomUUID: out of ids");
    i++;
    return id;
  };
}

/**
 * Deterministic `randomBytes` stub for `generateWorkflowId`. Returns a Buffer
 * of the requested length filled with the next byte sequence from `seqs`. The
 * substrate's id generator asks for 4 bytes per workflow id, so each seq entry
 * should be a 4-byte hex string (8 lowercase hex chars).
 */
export function fixedRandomBytes(seqs: readonly string[]): (n: number) => Buffer {
  let i = 0;
  return (n: number) => {
    const hex = seqs[i];
    if (hex === undefined) throw new Error("fixedRandomBytes: out of seqs");
    i++;
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== n) {
      throw new Error(`fixedRandomBytes: seq ${hex} has ${buf.length} bytes, expected ${n}`);
    }
    return buf;
  };
}

/**
 * A pool of valid UUIDv4 strings used across tests to make assertions
 * readable. Used for workflow node ids; workflow ids are generated in the
 * `<YYYYMMDD>-<8hex>` shape — use {@link fixedRandomBytes} to mint
 * deterministic workflow ids in tests.
 */
export const VALID_UUIDS: readonly WorkflowNodeId[] = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440003",
  "550e8400-e29b-41d4-a716-446655440004",
  "550e8400-e29b-41d4-a716-446655440005",
  "550e8400-e29b-41d4-a716-446655440006",
  "550e8400-e29b-41d4-a716-446655440007",
  "550e8400-e29b-41d4-a716-446655440008",
  "550e8400-e29b-41d4-a716-446655440009",
  "550e8400-e29b-41d4-a716-44665544000a",
  "550e8400-e29b-41d4-a716-44665544000b",
  "550e8400-e29b-41d4-a716-44665544000c",
  "550e8400-e29b-41d4-a716-44665544000d",
  "550e8400-e29b-41d4-a716-44665544000e",
  "550e8400-e29b-41d4-a716-44665544000f",
].map((u) => WorkflowNodeIdSchema.parse(u));

export const MISSING_WORKFLOW_ID: WorkflowId = WorkflowIdSchema.parse("20991231-deadbeef");

/**
 * Bootstrap a workflow + initial coord by invoking `createWorkflow` with
 * default args. Returns the created ids. Tests that exercise non-create paths
 * use this to avoid repeating the bootstrap.
 */
export async function bootstrap(
  f: WorkflowFixture,
  args: { readonly coordinatorAgent?: string; readonly brief?: string } = {},
): Promise<{ readonly workflowId: WorkflowId; readonly initialCoordNodeId: WorkflowNodeId }> {
  const res = await f.module.createWorkflow.execute({
    brief: args.brief ?? "test workflow",
    coordinatorAgent: args.coordinatorAgent ?? "coord-agent",
  });
  return res._unsafeUnwrap();
}

export async function addIteration(
  f: WorkflowFixture,
  args: {
    readonly workflowId: WorkflowId;
    readonly parentCoordId: WorkflowNodeId;
    readonly nodes: readonly {
      readonly tempId: string;
      readonly kind?: Exclude<WorkflowNodeKind, "coordinator">;
      readonly spec: unknown;
    }[];
    readonly coordSpec: unknown;
  },
): Promise<{
  readonly nodeIds: Readonly<Record<string, WorkflowNodeId>>;
  readonly workerIds: Readonly<Record<string, WorkflowNodeId>>;
  readonly coordId: WorkflowNodeId;
}> {
  const coordTempId = "__coord";
  const res = (
    await f.module.addSubgraph.execute({
      workflowId: args.workflowId,
      nodes: [
        ...args.nodes.map((node) => ({
          tempId: node.tempId,
          kind: node.kind ?? "worker",
          spec: node.spec,
          existingParents: [args.parentCoordId],
        })),
        {
          tempId: coordTempId,
          kind: "coordinator",
          spec: args.coordSpec,
          existingParents: [args.parentCoordId],
        },
      ],
      edges: args.nodes.map((node) => ({
        from: { kind: "temp" as const, tempId: node.tempId },
        to: { kind: "temp" as const, tempId: coordTempId },
      })),
    })
  )._unsafeUnwrap();
  const nodeIds: Record<string, WorkflowNodeId> = {};
  for (const inserted of res.insertedNodes) {
    if (inserted.tempId === coordTempId) continue;
    nodeIds[inserted.tempId] = inserted.nodeId;
  }
  const coord = res.insertedNodes.find((inserted) => inserted.tempId === coordTempId);
  if (coord === undefined) throw new Error("addIteration: coordinator not inserted");
  return { nodeIds, workerIds: nodeIds, coordId: coord.nodeId };
}

/**
 * Test-only setup seam that forces a node's lifecycle columns directly on the
 * row, bypassing the aggregate. Replaces the old repository's
 * `updateNodeLifecycle` (gone with the 3-method repo). Faithful because the new
 * write model reconstitutes the aggregate from rows on every `repo.get`, so a
 * raw row mutation between use-case calls is observed on the next read. Use it
 * to drive nodes into states the ordinary API won't easily produce (e.g. a
 * `succeeded` node so a mutation rejects with `WorkflowNodeNotMutable`).
 */
export async function setNodeLifecycle(
  f: WorkflowFixture,
  opts: {
    readonly id: string;
    readonly status?: WorkflowNodeStatus;
    readonly readyAt?: string | null;
    readonly runningAt?: string | null;
    readonly endedAt?: string | null;
  },
): Promise<void> {
  const patch: {
    status?: WorkflowNodeStatus;
    readyAt?: string | null;
    runningAt?: string | null;
    endedAt?: string | null;
  } = {};
  if (opts.status !== undefined) patch.status = opts.status;
  if (opts.readyAt !== undefined) patch.readyAt = opts.readyAt;
  if (opts.runningAt !== undefined) patch.runningAt = opts.runningAt;
  if (opts.endedAt !== undefined) patch.endedAt = opts.endedAt;
  const result = await f.db
    .update(workflowNodes)
    .set(patch)
    .where(eq(workflowNodes.id, opts.id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`setNodeLifecycle: node not found: ${opts.id}`);
}
