import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";
import { WorkflowBriefSchema } from "../../../src/domain/workflow/workflow-brief.js";
import { WorkflowEntity } from "../../../src/domain/workflow/workflow-entity.js";
import { type WorkflowId, WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/workflow-db.js";
import { DrizzleWorkflowRepository } from "../../../src/infrastructure/drizzle/workflow-repository.js";
import {
  workflowEdges,
  workflowNodes,
  workflows,
} from "../../../src/infrastructure/drizzle/workflow-schema.js";

const NOW = "2026-06-07T00:00:00.000Z";
const NODE_UUIDS = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
] as const;

function wfId(n: number): WorkflowId {
  return WorkflowIdSchema.parse(`20260607-${n.toString(16).padStart(8, "0")}`);
}

function nodeId(i: number): WorkflowNodeId {
  return WorkflowNodeIdSchema.parse(NODE_UUIDS[i]);
}

function makeWorkflow(id: WorkflowId): WorkflowEntity {
  const wf = WorkflowEntity.create({
    id,
    brief: WorkflowBriefSchema.parse("b"),
    coordinatorAgent: "coord-a",
    createdAt: NOW,
  });
  wf.addNode({
    nodeId: nodeId(0),
    kind: "coordinator",
    validatedSpec: { agent: "coord-a" },
    parents: [],
    nowIso: NOW,
  })._unsafeUnwrap();
  return wf;
}

function addIteration(wf: WorkflowEntity): void {
  wf.addSubgraph({
    nodes: [
      {
        tempId: "w",
        kind: "worker",
        validatedSpec: { agent: "w", brief: "x" },
        existingParents: [nodeId(0)],
      },
      {
        tempId: "c",
        kind: "coordinator",
        validatedSpec: { agent: "coord-b" },
        existingParents: [nodeId(0)],
      },
    ],
    edges: [{ from: { kind: "temp", tempId: "w" }, to: { kind: "temp", tempId: "c" } }],
    mintId: (tempId) => (tempId === "w" ? nodeId(1) : nodeId(2)),
    nowIso: NOW,
  })._unsafeUnwrap();
}

let db: Db;
let close: () => void;
let repo: DrizzleWorkflowRepository;

beforeEach(() => {
  ({ db, close } = openDb(":memory:"));
  repo = new DrizzleWorkflowRepository({ db });
});

afterEach(() => {
  close();
});

describe("DrizzleWorkflowRepository — save insert / get round-trip", () => {
  it("saves a fresh workflow + initial coord node and reads the aggregate back", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.id).toBe("20260607-00000001");
    expect(got.brief).toBe("b");
    expect(got.status).toBe("running");
    expect(got.coordinatorAgent).toBe("coord-a");
    expect(got.nodes.map((n) => n.id)).toEqual([nodeId(0)]);
    expect(got.nodes[0]?.kind).toBe("coordinator");
    expect(got.edges).toEqual([]);
  });

  it("round-trips nodes + edges for a frontier-valid iteration", async () => {
    const wf = makeWorkflow(wfId(1));
    addIteration(wf);
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.nodes.map((n) => n.id).sort()).toEqual([nodeId(0), nodeId(1), nodeId(2)].sort());
    expect(got.edges).toHaveLength(3);
    expect(got.edges.some((e) => e.from === nodeId(0) && e.to === nodeId(1))).toBe(true);
    expect(got.edges.some((e) => e.from === nodeId(0) && e.to === nodeId(2))).toBe(true);
    expect(got.edges.some((e) => e.from === nodeId(1) && e.to === nodeId(2))).toBe(true);
  });

  it("get returns WorkflowNotFound for a missing workflow id", async () => {
    const r = await repo.get(wfId(99));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("get surfaces WorkflowEntityCorruption for a row with an invalid status enum", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    db.update(workflows)
      .set({ status: "bogus" })
      .where(eq(workflows.id, "20260607-00000001"))
      .run();
    const r = await repo.get(wfId(1));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowInvariantViolation",
      subtype: "enumValue",
    });
  });
});

describe("DrizzleWorkflowRepository — save (snapshot diff)", () => {
  it("persists a header change (cancel) + its terminal payload", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    wf.cancel({ kind: "user", message: "stop" }, NOW)._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.status).toBe("cancelled");
    expect(got.endedAt).toBe(NOW);
    expect(got.cancellation).toEqual({ kind: "user", message: "stop" });
  });

  it("inserts newly added subgraph nodes on save", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    addIteration(wf);
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.nodes.map((n) => n.id).sort()).toEqual([nodeId(0), nodeId(1), nodeId(2)].sort());
    expect(got.edges).toHaveLength(3);
  });

  it("updates a node's lifecycle columns on save", async () => {
    const wf = makeWorkflow(wfId(1));
    addIteration(wf);
    (await repo.save(wf))._unsafeUnwrap();
    const loaded = (await repo.get(wfId(1)))._unsafeUnwrap();
    loaded.markNodeTerminal(nodeId(0), "succeeded", NOW)._unsafeUnwrap();
    loaded.markNodeRunning(nodeId(1), "2026-06-07T01:00:00.000Z")._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    const worker = got.nodes.find((n) => n.id === nodeId(1));
    expect(worker?.status).toBe("running");
    expect(worker?.runningAt).toBe("2026-06-07T01:00:00.000Z");
  });

  it("adds subgraph edges on save", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const loaded = (await repo.get(wfId(1)))._unsafeUnwrap();
    addIteration(loaded);
    (await repo.save(loaded))._unsafeUnwrap();
    const edges = (await repo.get(wfId(1)))._unsafeUnwrap().edges;
    expect(edges.some((e) => e.from === nodeId(0) && e.to === nodeId(1))).toBe(true);
    expect(edges.some((e) => e.from === nodeId(0) && e.to === nodeId(2))).toBe(true);
    expect(edges.some((e) => e.from === nodeId(1) && e.to === nodeId(2))).toBe(true);
    expect(edges).toHaveLength(3);
  });

  it("is a no-op when the aggregate has no changes since load", async () => {
    (await repo.save(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.status).toBe("running");
    expect(got.nodes.map((n) => n.id)).toEqual([nodeId(0)]);
  });
});

describe("DrizzleWorkflowRepository — delete", () => {
  it("hard-deletes the workflow + nodes + edges", async () => {
    const wf = makeWorkflow(wfId(1));
    addIteration(wf);
    (await repo.save(wf))._unsafeUnwrap();

    (await repo.delete(wfId(1)))._unsafeUnwrap();

    const r = await repo.get(wfId(1));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
    expect(
      db
        .select()
        .from(workflows)
        .where(eq(workflows.id, wfId(1)))
        .all(),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, wfId(1)))
        .all(),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, wfId(1)))
        .all(),
    ).toEqual([]);
  });
});
