import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";
import { WorkflowEntity } from "../../../src/domain/workflow/workflow-entity.js";
import { type WorkflowId, WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/workflow-db.js";
import { DrizzleWorkflowRepository } from "../../../src/infrastructure/drizzle/workflow-repository.js";
import { workflows } from "../../../src/infrastructure/drizzle/workflow-schema.js";

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

/** A running workflow with its initial coordinator node (no persistence yet). */
function makeWorkflow(id: WorkflowId): WorkflowEntity {
  const wf = WorkflowEntity.create({
    id,
    brief: "b",
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

describe("DrizzleWorkflowRepository — insert / get round-trip", () => {
  it("inserts a workflow + initial coord node and reads the aggregate back", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.id).toBe("20260607-00000001");
    expect(got.brief).toBe("b");
    expect(got.status).toBe("running");
    expect(got.coordinatorAgent).toBe("coord-a");
    expect(got.nodes.map((n) => n.id)).toEqual([nodeId(0)]);
    expect(got.nodes[0]?.kind).toBe("coordinator");
    expect(got.edges).toEqual([]);
  });

  it("round-trips nodes + edges (coord → worker)", async () => {
    const wf = makeWorkflow(wfId(1));
    wf.addNode({
      nodeId: nodeId(1),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "x" },
      parents: [nodeId(0)],
      nowIso: NOW,
    })._unsafeUnwrap();
    (await repo.insert(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.nodes.map((n) => n.id).sort()).toEqual([nodeId(0), nodeId(1)].sort());
    expect(got.edges).toHaveLength(1);
    expect(got.edges[0]?.from).toBe(nodeId(0));
    expect(got.edges[0]?.to).toBe(nodeId(1));
  });

  it("get returns WorkflowNotFound for a missing workflow id", async () => {
    const r = await repo.get(wfId(99));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("get surfaces WorkflowEntityCorruption for a row with an invalid status enum", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    // Corrupt the persisted status out-of-band; the mapper must reject it.
    db.update(workflows)
      .set({ status: "bogus" })
      .where(eq(workflows.id, "20260607-00000001"))
      .run();
    const r = await repo.get(wfId(1));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowEnumValueCorruption");
  });
});

describe("DrizzleWorkflowRepository — save (snapshot diff)", () => {
  it("persists a header change (cancel) + its terminal payload", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    wf.cancel({ kind: "user", message: "stop" }, NOW)._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.status).toBe("cancelled");
    expect(got.endedAt).toBe(NOW);
    expect(got.cancellation).toEqual({ kind: "user", message: "stop" });
  });

  it("inserts a newly added node on save", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    wf.addNode({
      nodeId: nodeId(1),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "x" },
      parents: [nodeId(0)],
      nowIso: NOW,
    })._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.nodes.map((n) => n.id).sort()).toEqual([nodeId(0), nodeId(1)].sort());
    expect(got.edges).toHaveLength(1);
  });

  it("deletes a removed node (and its edges) on save", async () => {
    const wf = makeWorkflow(wfId(1));
    wf.addNode({
      nodeId: nodeId(1),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "x" },
      parents: [nodeId(0)],
      nowIso: NOW,
    })._unsafeUnwrap();
    (await repo.insert(wf))._unsafeUnwrap();

    const loaded = (await repo.get(wfId(1)))._unsafeUnwrap();
    loaded.removeNode(nodeId(1))._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();

    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.nodes.map((n) => n.id)).toEqual([nodeId(0)]);
    expect(got.edges).toEqual([]);
  });

  it("updates a node's lifecycle columns on save", async () => {
    const wf = makeWorkflow(wfId(1));
    wf.addNode({
      nodeId: nodeId(1),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "x" },
      parents: [nodeId(0)],
      nowIso: NOW,
    })._unsafeUnwrap();
    (await repo.insert(wf))._unsafeUnwrap();

    // Drive the coord terminal so the worker becomes runnable, then run it.
    const loaded = (await repo.get(wfId(1)))._unsafeUnwrap();
    loaded.markNodeTerminal(nodeId(0), "succeeded", undefined, NOW)._unsafeUnwrap();
    loaded.markNodeRunning(nodeId(1), "2026-06-07T01:00:00.000Z")._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();

    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    const worker = got.nodes.find((n) => n.id === nodeId(1));
    expect(worker?.status).toBe("running");
    expect(worker?.runningAt).toBe("2026-06-07T01:00:00.000Z");
  });

  it("adds and removes edges on save", async () => {
    const wf = makeWorkflow(wfId(1));
    wf.addNode({
      nodeId: nodeId(1),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "a" },
      parents: [nodeId(0)],
      nowIso: NOW,
    })._unsafeUnwrap();
    wf.addNode({
      nodeId: nodeId(2),
      kind: "worker",
      validatedSpec: { agent: "w", brief: "b" },
      parents: [nodeId(0), nodeId(1)],
      nowIso: NOW,
    })._unsafeUnwrap();
    (await repo.insert(wf))._unsafeUnwrap();
    expect((await repo.get(wfId(1)))._unsafeUnwrap().edges).toHaveLength(3);

    // Remove the coord→node2 edge; node2 keeps node1 as parent.
    const loaded = (await repo.get(wfId(1)))._unsafeUnwrap();
    loaded.removeEdge(nodeId(0), nodeId(2))._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();

    const edges = (await repo.get(wfId(1)))._unsafeUnwrap().edges;
    expect(edges.some((e) => e.from === nodeId(0) && e.to === nodeId(2))).toBe(false);
    expect(edges).toHaveLength(2);
  });

  it("cascade-deletes the workflow + nodes + edges when the aggregate is marked deleted", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    wf.cancel({ kind: "user", message: "" }, NOW)._unsafeUnwrap();
    wf.markDeleted()._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const r = await repo.get(wfId(1));
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("is a no-op when the aggregate has no changes since load", async () => {
    (await repo.insert(makeWorkflow(wfId(1))))._unsafeUnwrap();
    const wf = (await repo.get(wfId(1)))._unsafeUnwrap();
    (await repo.save(wf))._unsafeUnwrap();
    const got = (await repo.get(wfId(1)))._unsafeUnwrap();
    expect(got.status).toBe("running");
    expect(got.nodes.map((n) => n.id)).toEqual([nodeId(0)]);
  });
});
