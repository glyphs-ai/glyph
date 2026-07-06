import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TaskId, TaskIdSchema } from "../../../src/domain/task-id.js";
import { LocalTaskSandbox } from "../../../src/infrastructure/file/local-task-sandbox.js";

const ID: TaskId = TaskIdSchema.parse("20260508-9dfbdf05");
let root: string;
let sandbox: LocalTaskSandbox;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "task-ws-"));
  sandbox = new LocalTaskSandbox({ root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalTaskSandbox.reserve", () => {
  it("creates the workdir and returns its path", async () => {
    const r = await sandbox.reserve(ID);
    const dir = r._unsafeUnwrap();
    expect(dir).toBe(join(root, ID));
    expect(existsSync(dir)).toBe(true);
  });

  it("fails with WorkdirFailed (phase: reserve) when the workdir already exists", async () => {
    await sandbox.reserve(ID);
    const again = await sandbox.reserve(ID);
    expect(again._unsafeUnwrapErr()).toMatchObject({ type: "WorkdirFailed", phase: "reserve" });
  });

  it("creates the sandbox root lazily when it does not exist", async () => {
    const nestedRoot = join(root, "nested", "tasks");
    const nested = new LocalTaskSandbox({ root: nestedRoot });
    const dir = (await nested.reserve(ID))._unsafeUnwrap();
    expect(dir).toBe(join(nestedRoot, ID));
    expect(existsSync(dir)).toBe(true);
  });
});

describe("LocalTaskSandbox.materialize", () => {
  it("writes TASK.md plus the temp/ and artifact/ subdirs", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    const r = await sandbox.materialize({ workdir, brief: "title", details: "body" });
    expect(r.isOk()).toBe(true);
    expect(readFileSync(join(workdir, "TASK.md"), "utf8")).toBe("# title\n\nbody\n");
    expect(existsSync(join(workdir, "temp"))).toBe(true);
    expect(existsSync(join(workdir, "artifact"))).toBe(true);
  });

  it("renders a brief-only TASK.md when details are absent", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    (
      await sandbox.materialize({ workdir, brief: "just a title", details: undefined })
    )._unsafeUnwrap();
    expect(readFileSync(join(workdir, "TASK.md"), "utf8")).toBe("# just a title\n");
  });

  it("does not double the trailing LF when details already end in one", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    (await sandbox.materialize({ workdir, brief: "t", details: "body\n" }))._unsafeUnwrap();
    expect(readFileSync(join(workdir, "TASK.md"), "utf8")).toBe("# t\n\nbody\n");
  });
});

describe("LocalTaskSandbox.listArtifacts", () => {
  it("returns artifact paths relative to artifact/, sorted", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    await sandbox.materialize({ workdir, brief: "b", details: undefined });
    writeFileSync(join(workdir, "artifact", "b.html"), "b");
    writeFileSync(join(workdir, "artifact", "a.html"), "a");
    const files = (await sandbox.listArtifacts(workdir))._unsafeUnwrap();
    expect(files.map((f) => f.relPath)).toEqual(["a.html", "b.html"]);
    expect(files[0]).toMatchObject({ relPath: "a.html", size: 1 });
    expect(typeof files[0]!.modifiedAt).toBe("string");
  });

  it("resolves to [] when the artifact dir does not exist", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    const r = await sandbox.listArtifacts(workdir);
    expect(r._unsafeUnwrap()).toEqual([]);
  });

  it("recursively lists files at any depth as POSIX relPaths, sorted", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    await sandbox.materialize({ workdir, brief: "b", details: undefined });
    const art = join(workdir, "artifact");
    mkdirSync(join(art, "sub", "deep"), { recursive: true });
    writeFileSync(join(art, "top.txt"), "t");
    writeFileSync(join(art, "sub", "mid.txt"), "m");
    writeFileSync(join(art, "sub", "deep", "leaf.txt"), "l");
    const files = (await sandbox.listArtifacts(workdir))._unsafeUnwrap();
    expect(files.map((f) => f.relPath)).toEqual(["sub/deep/leaf.txt", "sub/mid.txt", "top.txt"]);
  });
});

describe("LocalTaskSandbox.resolveArtifactPath", () => {
  it("joins a relPath under the task's artifact/ root", () => {
    const workdir = sandbox.resolve(ID);
    expect(sandbox.resolveArtifactPath(ID, "ref/test.md")).toBe(
      join(workdir, "artifact", "ref", "test.md"),
    );
  });

  it("returns null for an escaping or empty relPath", () => {
    expect(sandbox.resolveArtifactPath(ID, "../../etc/passwd")).toBeNull();
    expect(sandbox.resolveArtifactPath(ID, "")).toBeNull();
  });
});

describe("LocalTaskSandbox.remove", () => {
  it("recursively removes the workdir", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    await sandbox.materialize({ workdir, brief: "b", details: undefined });
    const r = await sandbox.remove(workdir);
    expect(r.isOk()).toBe(true);
    expect(existsSync(workdir)).toBe(false);
  });
});
