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

  it("fails with WorkdirReservationFailed when the workdir already exists", async () => {
    await sandbox.reserve(ID);
    const again = await sandbox.reserve(ID);
    expect(again._unsafeUnwrapErr().type).toBe("WorkdirReservationFailed");
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
  it("returns absolute artifact paths sorted by name", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    await sandbox.materialize({ workdir, brief: "b", details: undefined });
    writeFileSync(join(workdir, "artifact", "b.html"), "b");
    writeFileSync(join(workdir, "artifact", "a.html"), "a");
    const r = await sandbox.listArtifacts(workdir);
    expect(r._unsafeUnwrap()).toEqual([
      join(workdir, "artifact", "a.html"),
      join(workdir, "artifact", "b.html"),
    ]);
  });

  it("resolves to [] when the artifact dir does not exist", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    const r = await sandbox.listArtifacts(workdir);
    expect(r._unsafeUnwrap()).toEqual([]);
  });

  it("recursively lists files at any depth, sorted by path", async () => {
    const workdir = (await sandbox.reserve(ID))._unsafeUnwrap();
    await sandbox.materialize({ workdir, brief: "b", details: undefined });
    const art = join(workdir, "artifact");
    mkdirSync(join(art, "sub", "deep"), { recursive: true });
    writeFileSync(join(art, "top.txt"), "t");
    writeFileSync(join(art, "sub", "mid.txt"), "m");
    writeFileSync(join(art, "sub", "deep", "leaf.txt"), "l");
    const r = await sandbox.listArtifacts(workdir);
    const expected = [
      join(art, "top.txt"),
      join(art, "sub", "mid.txt"),
      join(art, "sub", "deep", "leaf.txt"),
    ].sort((a, b) => a.localeCompare(b));
    expect(r._unsafeUnwrap()).toEqual(expected);
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
