import { mkdir, writeFile } from "node:fs/promises";
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

describe("ListWorkflowArtifactsUseCase", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("returns summary artifacts before node artifacts", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const summaryRoot = path.join(f.workspaceDir, "workflows", workflowId, "artifact");
    await mkdir(summaryRoot, { recursive: true });
    await writeFile(path.join(summaryRoot, "summary.md"), "summary", "utf8");
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "draft", spec: { agent: "writer", brief: "draft" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.draft!;
    f.workerRunner.artifactListings.set(nodeId, {
      artifacts: [
        {
          relPath: "result.json",
          size: 2,
          modifiedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
    });

    const result = await f.module.listWorkflowArtifacts.execute({ workflowId });

    expect(result._unsafeUnwrap().artifacts.map((a) => a.kind)).toEqual([
      "workflow-summary",
      "node",
    ]);
  });

  it("skips coordinator and human nodes when their runners return null", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [
        {
          tempId: "human",
          kind: "human",
          spec: { prompt: "approve?", promptStyle: "plain" },
        },
      ],
      coordSpec: { agent: "coord-next" },
    });

    const result = await f.module.listWorkflowArtifacts.execute({ workflowId });

    expect(result._unsafeUnwrap().artifacts).toEqual([]);
  });

  it("returns WorkflowNotFound for a missing workflow", async () => {
    const result = await f.module.listWorkflowArtifacts.execute({
      workflowId: MISSING_WORKFLOW_ID,
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "WorkflowNotFound" });
  });
});
