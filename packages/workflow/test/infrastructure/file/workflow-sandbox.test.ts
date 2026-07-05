import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowSandbox, workflowDir } from "../../../src/infrastructure/file/workflow-sandbox.js";

// NOTE: the old `paths.test.ts` unit-tested `safeJoinUnderRoot` as a directly
// imported free function. In the CQRS layout that path-component guard is a
// PRIVATE method of `WorkflowSandbox` (defense-in-depth behind the id-grammar
// check). Since a workflow/node id that passes the grammar can never contain a
// path separator, the inner guard is unreachable with dangerous input through
// the public surface — so these scenarios are preserved by routing dangerous
// ids through `WorkflowSandbox.workflowDir`, where the id-grammar rejects them
// first. The rejection message is the validator's (`invalid workflow id`)
// rather than the inner guard's (`invalid workflow path component`).

describe("WorkflowSandbox.workflowDir — path safety", () => {
  const root = path.resolve("/tmp/wfroot");
  const sandbox = new WorkflowSandbox({ root });

  it("accepts a normal id and joins under root", () => {
    const out = sandbox.workflowDir("20260522-aaaaaaaa");
    expect(out).toBe(path.join(root, "20260522-aaaaaaaa"));
  });

  it("rejects empty id", () => {
    expect(() => sandbox.workflowDir("")).toThrow(/invalid workflow id/i);
  });

  it("rejects '.'", () => {
    expect(() => sandbox.workflowDir(".")).toThrow(/invalid workflow id/i);
  });

  it("rejects '..'", () => {
    expect(() => sandbox.workflowDir("..")).toThrow(/invalid workflow id/i);
  });

  it("rejects forward slash", () => {
    expect(() => sandbox.workflowDir("a/b")).toThrow(/invalid workflow id/i);
  });

  it("rejects backslash", () => {
    expect(() => sandbox.workflowDir("a\\b")).toThrow(/invalid workflow id/i);
  });

  it("rejects null byte", () => {
    expect(() => sandbox.workflowDir("a\0b")).toThrow(/invalid workflow id/i);
  });
});

describe("workflowDir", () => {
  it("workflowDir composes <workspace>/workflows/<id>", () => {
    const ws = path.resolve("/tmp/ws");
    expect(workflowDir(ws, "20260522-aaaaaaaa")).toBe(
      path.join(ws, "workflows", "20260522-aaaaaaaa"),
    );
  });

  describe("WorkflowSandbox artifacts", () => {
    it("lists nested artifact files with forward-slash relative paths", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "workflow-sandbox-test-"));
      try {
        const sandbox = new WorkflowSandbox({ root });
        const artifactRoot = path.join(root, "20260522-aaaaaaaa", "artifact");
        await mkdir(path.join(artifactRoot, "nested"), { recursive: true });
        await writeFile(path.join(artifactRoot, "nested", "report.md"), "hello", "utf8");

        const files = await sandbox.listArtifacts("20260522-aaaaaaaa");

        expect(files).toHaveLength(1);
        expect(files[0]?.relPath).toBe("nested/report.md");
        expect(files[0]?.size).toBe(5);
        expect(files[0]?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("returns [] when the artifact dir is missing", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "workflow-sandbox-test-"));
      try {
        const sandbox = new WorkflowSandbox({ root });
        await mkdir(path.join(root, "20260522-aaaaaaaa"), { recursive: true });

        await expect(sandbox.listArtifacts("20260522-aaaaaaaa")).resolves.toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("resolves safe artifact paths and rejects traversal", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "workflow-sandbox-test-"));
      try {
        const sandbox = new WorkflowSandbox({ root });
        expect(sandbox.resolveArtifactPath("20260522-aaaaaaaa", "nested/report.md")).toBe(
          path.join(root, "20260522-aaaaaaaa", "artifact", "nested", "report.md"),
        );
        expect(sandbox.resolveArtifactPath("20260522-aaaaaaaa", "../escape.md")).toBeNull();
        expect(sandbox.resolveArtifactPath("20260522-aaaaaaaa", "")).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("removes workflow dirs idempotently", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "workflow-sandbox-test-"));
      try {
        const sandbox = new WorkflowSandbox({ root });
        const dir = path.join(root, "20260522-aaaaaaaa");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "marker.txt"), "x", "utf8");

        await sandbox.remove("20260522-aaaaaaaa");
        await expect(access(dir)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(sandbox.remove("20260522-aaaaaaaa")).resolves.toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("rejects traversal ids before removing", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "workflow-sandbox-test-"));
      try {
        const sandbox = new WorkflowSandbox({ root });

        await expect(sandbox.remove("../escape")).rejects.toThrow(/invalid workflow id/i);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  it("workflowDir rejects an id that does not match the workflow id grammar", () => {
    const ws = path.resolve("/tmp/ws");
    // Grammar check fires before the path-component guard; the error surface is
    // the validator's, not the path-component guard's.
    expect(() => workflowDir(ws, "not-a-valid-id")).toThrow(/invalid workflow id/i);
  });
});
