import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceIdInvalidError } from "../src/index.js";
import {
  setupWorkspaceTestSubsystem,
  teardownWorkspaceTestSubsystem,
  type WorkspaceTestSubsystem,
} from "./_test-support.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

let scratch: string;
let sys: WorkspaceTestSubsystem;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-ws-queries-"));
  sys = await setupWorkspaceTestSubsystem();
});

afterEach(async () => {
  await teardownWorkspaceTestSubsystem(sys);
  await rm(scratch, { recursive: true, force: true });
});

describe("WorkspaceService reads", () => {
  it("get returns the full view for a registered workspace", async () => {
    const wsDir = path.join(scratch, "p");
    await sys.service.register({ id: UUID_A, workspaceDir: wsDir, name: "Project" });
    const view = await sys.service.get(UUID_A);
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      id: UUID_A,
      name: "Project",
      workspaceDir: path.resolve(wsDir),
    });
    expect(typeof view?.createdAt).toBe("string");
    expect(typeof view?.lastOpenedAt).toBe("string");
  });

  it("get returns null for an unknown id", async () => {
    expect(await sys.service.get(UUID_A)).toBeNull();
  });

  it("get throws WorkspaceIdInvalidError for a malformed id", async () => {
    await expect(sys.service.get("not-a-uuid")).rejects.toBeInstanceOf(WorkspaceIdInvalidError);
  });

  it("get with malformed id throws WorkspaceError (consistent with writes)", async () => {
    // Regression guard: reads and writes now both validate the id
    // and throw WorkspaceError subclasses for malformed input.
    const malformedIds = ["not-a-uuid", "", "123", "null"];
    for (const id of malformedIds) {
      await expect(sys.service.get(id)).rejects.toBeInstanceOf(WorkspaceIdInvalidError);
    }
  });

  it("list returns workspaces ordered by lastOpenedAt DESC", async () => {
    await sys.service.register({
      id: UUID_A,
      workspaceDir: path.join(scratch, "a"),
      name: "A",
    });
    await new Promise((r) => setTimeout(r, 5));
    await sys.service.register({
      id: UUID_B,
      workspaceDir: path.join(scratch, "b"),
      name: "B",
    });
    const list = await sys.service.list();
    expect(list.map((v) => v.id)).toEqual([UUID_B, UUID_A]);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("workspaceDir");
    expect(list[0]).toHaveProperty("lastOpenedAt");
  });

  it("list returns [] on an empty registry", async () => {
    expect(await sys.service.list()).toEqual([]);
  });

  it("getLastOpenedId returns null on an empty registry", async () => {
    expect(await sys.service.getLastOpenedId()).toBeNull();
  });

  it("getLastOpenedId returns the most-recently-opened workspace's id", async () => {
    await sys.service.register({
      id: UUID_A,
      workspaceDir: path.join(scratch, "a"),
      name: "A",
    });
    await new Promise((r) => setTimeout(r, 5));
    await sys.service.register({
      id: UUID_B,
      workspaceDir: path.join(scratch, "b"),
      name: "B",
    });
    expect(await sys.service.getLastOpenedId()).toBe(UUID_B);
  });

  it("getLastOpened returns the full view of the most-recently-opened workspace", async () => {
    await sys.service.register({
      id: UUID_A,
      workspaceDir: path.join(scratch, "a"),
      name: "X",
    });
    const view = await sys.service.getLastOpened();
    expect(view?.id).toBe(UUID_A);
    expect(view?.name).toBe("X");
    expect(typeof view?.lastOpenedAt).toBe("string");
  });
});
