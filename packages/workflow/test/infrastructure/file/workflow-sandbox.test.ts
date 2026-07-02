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

  it("workflowDir rejects an id that does not match the workflow id grammar", () => {
    const ws = path.resolve("/tmp/ws");
    // Grammar check fires before the path-component guard; the error surface is
    // the validator's, not the path-component guard's.
    expect(() => workflowDir(ws, "not-a-valid-id")).toThrow(/invalid workflow id/i);
  });
});
