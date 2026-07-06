import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TaskModule } from "@glyphs-ai/task";
import type { WorkflowId, WorkflowModule } from "@glyphs-ai/workflow";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workflowsRoutes } from "../../src/routes/workflows.js";

const WID = "20260607-aabbccdd";
const WORKER_NID = "550e8400-e29b-41d4-a716-446655440002";
const OTHER_NID = "550e8400-e29b-41d4-a716-446655440003";

function stubModule(
  overrides: {
    listWorkflowArtifacts?: { execute: ReturnType<typeof vi.fn> };
    resolveWorkflowArtifactPath?: { execute: ReturnType<typeof vi.fn> };
  } = {},
): WorkflowModule {
  return {
    listWorkflowArtifacts: overrides.listWorkflowArtifacts ?? {
      execute: vi.fn(() => okAsync({ artifacts: [] })),
    },
    resolveWorkflowArtifactPath: overrides.resolveWorkflowArtifactPath ?? {
      execute: vi.fn(() => okAsync(null)),
    },
  } as unknown as WorkflowModule;
}

function mountRoutes(svc: WorkflowModule) {
  return workflowsRoutes(
    () => svc,
    () => ({}) as TaskModule,
    () => workspaceDir,
  );
}

let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "wf-artifacts-test-"));
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function writeFileAt(dir: string, name: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, body, "utf8");
  return file;
}

describe("workflowsRoutes — artifacts list", () => {
  it("forwards workflow-summary entries verbatim", async () => {
    const artifacts = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 4,
        modifiedAt: "2026-06-07T00:00:00.000Z",
      },
      {
        kind: "workflow-summary",
        relPath: "chart.png",
        size: 8,
        modifiedAt: "2026-06-07T00:00:01.000Z",
      },
    ];
    const svc = stubModule({
      listWorkflowArtifacts: { execute: vi.fn(() => okAsync({ artifacts })) },
    });

    const res = await mountRoutes(svc).request(`/${WID}/artifacts`);

    expect(res.status).toBe(200);
    expect((await res.json()) as { artifacts: unknown[] }).toEqual({ artifacts });
  });

  it("forwards worker-node entries verbatim", async () => {
    const artifacts = [
      {
        kind: "node",
        nodeId: WORKER_NID,
        relPath: "result.json",
        size: 2,
        modifiedAt: "2026-06-07T00:00:00.000Z",
      },
    ];
    const svc = stubModule({
      listWorkflowArtifacts: { execute: vi.fn(() => okAsync({ artifacts })) },
    });

    const res = await mountRoutes(svc).request(`/${WID}/artifacts`);

    expect(res.status).toBe(200);
    expect((await res.json()) as { artifacts: unknown[] }).toEqual({ artifacts });
  });

  it("returns an empty array when the workflow use-case has no entries", async () => {
    const res = await mountRoutes(stubModule()).request(`/${WID}/artifacts`);

    expect(res.status).toBe(200);
    expect((await res.json()) as { artifacts: unknown[] }).toEqual({ artifacts: [] });
  });

  it("404s when the workflow id is unknown", async () => {
    const svc = stubModule({
      listWorkflowArtifacts: {
        execute: vi.fn(() => errAsync({ type: "WorkflowNotFound", workflowId: WID as WorkflowId })),
      },
    });

    const res = await mountRoutes(svc).request(`/${WID}/artifacts`);

    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).code).toBe("WorkflowNotFound");
  });

  it("500s when artifact listing faults", async () => {
    const svc = stubModule({
      listWorkflowArtifacts: {
        execute: vi.fn(() =>
          errAsync({ type: "WorkflowArtifactListingFailed", cause: new Error("db down") }),
        ),
      },
    });

    const res = await mountRoutes(svc).request(`/${WID}/artifacts`);

    expect(res.status).toBe(500);
  });
});

describe("workflowsRoutes — artifacts bytes", () => {
  it("streams summary bytes with Cache-Control: no-store", async () => {
    const abs = await writeFileAt(workspaceDir, "report.md", "# hello world");
    const svc = stubModule({
      resolveWorkflowArtifactPath: {
        execute: vi.fn(() => okAsync(abs)),
      },
    });
    const encoded = encodeURIComponent("summary/report.md");

    const res = await mountRoutes(svc).request(`/${WID}/artifacts/${encoded}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toMatch(/text\/markdown/);
    expect(await res.text()).toBe("# hello world");
  });

  it("streams node bytes with Cache-Control: max-age=300", async () => {
    const abs = await writeFileAt(workspaceDir, "out.txt", "result");
    const svc = stubModule({
      resolveWorkflowArtifactPath: {
        execute: vi.fn((req: { ref: { kind: string; nodeId?: string; relPath: string } }) => {
          expect(req.ref).toEqual({ kind: "node", nodeId: WORKER_NID, relPath: "out.txt" });
          return okAsync(abs);
        }),
      },
    });
    const encoded = encodeURIComponent(`nodes/${WORKER_NID}/out.txt`);

    const res = await mountRoutes(svc).request(`/${WID}/artifacts/${encoded}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("max-age=300");
    expect(await res.text()).toBe("result");
  });

  it("404s when the use-case returns null for a missing node artifact", async () => {
    const encoded = encodeURIComponent(`nodes/${WORKER_NID}/out.txt`);

    const res = await mountRoutes(stubModule()).request(`/${WID}/artifacts/${encoded}`);

    expect(res.status).toBe(404);
  });

  it("404s when the node is not in the addressed workflow", async () => {
    const encoded = encodeURIComponent(`nodes/${OTHER_NID}/out.txt`);

    const res = await mountRoutes(stubModule()).request(`/${WID}/artifacts/${encoded}`);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toBe("no such node in workflow");
  });

  it("rejects traversal attempts in the artifact path with 400", async () => {
    const encoded = encodeURIComponent("summary/../../escape.md");

    const res = await mountRoutes(stubModule()).request(`/${WID}/artifacts/${encoded}`);

    expect(res.status).toBe(400);
  });
});
