import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InputValidationError,
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceIdInvalidError,
  WorkspaceNameInvalidError,
  WorkspacePathConflictError,
  WorkspacePathInvalidError,
} from "../src/index.js";
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
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-ws-register-"));
  sys = await setupWorkspaceTestSubsystem();
});

afterEach(async () => {
  await teardownWorkspaceTestSubsystem(sys);
  await rm(scratch, { recursive: true, force: true });
});

describe("WorkspaceService.register", () => {
  it("creates workspaceDir + sessions/tasks subdirs and persists the row", async () => {
    const wsDir = path.join(scratch, "p");
    const result = await sys.service.register({
      id: UUID_A,
      workspaceDir: wsDir,
      name: "My Project",
    });
    expect(result.id).toBe(UUID_A);

    const view = await sys.service.get(UUID_A);
    expect(view).not.toBeNull();
    expect(view?.name).toBe("My Project");
    expect(view?.workspaceDir).toBe(path.resolve(wsDir));

    expect((await stat(wsDir)).isDirectory()).toBe(true);
    expect((await stat(path.join(wsDir, "sessions"))).isDirectory()).toBe(true);
    expect((await stat(path.join(wsDir, "tasks"))).isDirectory()).toBe(true);
    // `catalog/` is allocated by @glyphs-ai/catalog, not this pkg —
    // register() must not pre-create it (would mask catalog's own
    // install behaviour).
    await expect(stat(path.join(wsDir, "catalog"))).rejects.toThrow();
  });

  it("rejects an invalid display name", async () => {
    await expect(
      sys.service.register({ id: UUID_A, workspaceDir: path.join(scratch, "x"), name: "" }),
    ).rejects.toBeInstanceOf(WorkspaceNameInvalidError);
    expect(await sys.service.get(UUID_A)).toBeNull();
  });

  it("rejects a non-UUID id", async () => {
    await expect(
      sys.service.register({
        id: "not-a-uuid",
        workspaceDir: path.join(scratch, "x"),
        name: "Project",
      }),
    ).rejects.toBeInstanceOf(WorkspaceIdInvalidError);
  });

  it("rejects an id collision", async () => {
    const wsDir1 = path.join(scratch, "p1");
    const wsDir2 = path.join(scratch, "p2");
    await sys.service.register({ id: UUID_A, workspaceDir: wsDir1, name: "first" });
    await expect(
      sys.service.register({ id: UUID_A, workspaceDir: wsDir2, name: "dupe id" }),
    ).rejects.toBeInstanceOf(WorkspaceIdConflictError);
  });

  it("rejects a path collision with a typed WorkspacePathConflictError", async () => {
    const wsDir = path.join(scratch, "shared");
    await sys.service.register({ id: UUID_A, workspaceDir: wsDir, name: "first" });
    await expect(
      sys.service.register({ id: UUID_B, workspaceDir: wsDir, name: "second" }),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
  });

  it("throws InputValidationError when opts fail the zod shape check", async () => {
    const promise = sys.service.register({
      id: UUID_A,
      name: "Project",
      // workspaceDir omitted — fails RegisterWorkspaceOptsSchema's shape
    } as unknown as Parameters<typeof sys.service.register>[0]);
    await expect(promise).rejects.toBeInstanceOf(InputValidationError);
    // InputValidationError extends WorkspaceError so a single
    // instanceof filter catches all workspace-package failures.
    await expect(promise).rejects.toBeInstanceOf(WorkspaceError);
  });

  it("throws InputValidationError when workspaceDir is empty", async () => {
    await expect(
      sys.service.register({ id: UUID_A, workspaceDir: "", name: "Project" }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("throws WorkspacePathInvalidError when workspaceDir is relative", async () => {
    await expect(
      sys.service.register({ id: UUID_A, workspaceDir: "relative/p", name: "Project" }),
    ).rejects.toBeInstanceOf(WorkspacePathInvalidError);
  });

  it("every input-validation failure is instanceof WorkspaceError", async () => {
    // Regression guard: the HTTP error-mapping layer uses a single
    // `instanceof WorkspaceError` filter to catch all 4xx-class
    // workspace failures. Every validation rejection path must satisfy it.
    const cases: Array<{ opts: Parameters<typeof sys.service.register>[0] }> = [
      { opts: { id: UUID_A, name: "P" } as never },
      { opts: { id: UUID_A, workspaceDir: "", name: "P" } },
      {
        opts: { id: UUID_A, workspaceDir: "rel/path", name: "P" },
      },
      { opts: { id: "bad", workspaceDir: "/tmp/x", name: "P" } },
      { opts: { id: UUID_A, workspaceDir: "/tmp/x", name: "" } },
      {
        opts: { id: UUID_A, workspaceDir: "/tmp/x", name: "a".repeat(65) },
      },
    ];
    for (const { opts } of cases) {
      await expect(sys.service.register(opts)).rejects.toBeInstanceOf(WorkspaceError);
      // Safety: also ensure we don't get a pass because the error is
      // never thrown at all.
      await expect(sys.service.register(opts)).rejects.toThrow();
    }
  });
});
