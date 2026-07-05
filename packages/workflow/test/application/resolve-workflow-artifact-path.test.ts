import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("ResolveWorkflowArtifactPathUseCase", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("resolves summary artifact paths under the workflow artifact root", async () => {
    const { workflowId } = await bootstrap(f);

    const result = await f.module.resolveWorkflowArtifactPath.execute({
      workflowId,
      ref: { kind: "summary", relPath: "summary.md" },
    });

    expect(result._unsafeUnwrap()).toBe(
      path.join(f.workspaceDir, "workflows", workflowId, "artifact", "summary.md"),
    );
  });

  it("rejects summary traversal with null", async () => {
    const { workflowId } = await bootstrap(f);

    const result = await f.module.resolveWorkflowArtifactPath.execute({
      workflowId,
      ref: { kind: "summary", relPath: "../escape.md" },
    });

    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("delegates worker node artifact resolution through the runner", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "draft", spec: { agent: "writer", brief: "draft" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.draft!;
    const abs = path.join(f.workspaceDir, "tasks", "20260607-aaaa1111", "artifact", "out.txt");
    f.workerRunner.artifactPaths.set(`${nodeId}:out.txt`, abs);

    const result = await f.module.resolveWorkflowArtifactPath.execute({
      workflowId,
      ref: { kind: "node", nodeId, relPath: "out.txt" },
    });

    expect(result._unsafeUnwrap()).toBe(abs);
  });

  it("returns null when a node is not in the workflow DAG", async () => {
    const { workflowId } = await bootstrap(f);

    const result = await f.module.resolveWorkflowArtifactPath.execute({
      workflowId,
      ref: { kind: "node", nodeId: VALID_UUIDS[10]!, relPath: "out.txt" },
    });

    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("returns WorkflowNotFound for a missing workflow on node refs", async () => {
    const result = await f.module.resolveWorkflowArtifactPath.execute({
      workflowId: MISSING_WORKFLOW_ID,
      ref: { kind: "node", nodeId: VALID_UUIDS[10]!, relPath: "out.txt" },
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "WorkflowNotFound" });
  });
});
