import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { projectWorkspace, WorkspaceService } from "../../src/application/workspace.service.js";
import {
  WorkspaceIdConflictError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
} from "../../src/contract/workspace.errors.js";
import type { WorkspaceRepository } from "../../src/persistence/workspace.repository.js";
import { aRegisterRequest, aWorkspace } from "../_fixtures/workspace.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ABS_DIR = process.platform === "win32" ? "C:\\workspaces\\project" : "/workspaces/project";
const DEFAULT_PARENT = process.platform === "win32" ? "C:\\glyph\\workspaces" : "/glyph/workspaces";

let repo: MockProxy<WorkspaceRepository>;
let service: WorkspaceService;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  service = new WorkspaceService({ repo, defaultWorkspaceParent: DEFAULT_PARENT });
  vi.clearAllMocks();
});

// ─── Reads ───────────────────────────────────────────────────

describe("WorkspaceService.get", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(service.get("not-a-uuid")).rejects.toBeInstanceOf(ZodError);
  });

  it("returns projected DTO when found", async () => {
    const entity = aWorkspace({ id: VALID_ID, lastOpenedAt: "2025-06-01T00:00:00.000Z" });
    repo.findById.mockResolvedValue(entity);

    const result = await service.get(VALID_ID);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(VALID_ID);
    expect(result!.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
    expect(repo.findById).toHaveBeenCalledWith(VALID_ID);
  });

  it("returns null when not found", async () => {
    repo.findById.mockResolvedValue(undefined);
    expect(await service.get(VALID_ID)).toBeNull();
  });

  it("coalesces null lastOpenedAt to createdAt in the projection", async () => {
    const entity = aWorkspace({
      id: VALID_ID,
      lastOpenedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    repo.findById.mockResolvedValue(entity);
    const result = await service.get(VALID_ID);
    expect(result!.lastOpenedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("WorkspaceService.list", () => {
  it("maps entities to projected DTOs", async () => {
    const entities = [
      aWorkspace({ id: VALID_ID, name: "A", lastOpenedAt: "2025-06-01T00:00:00.000Z" }),
      aWorkspace({
        id: OTHER_ID,
        name: "B",
        lastOpenedAt: null,
        createdAt: "2025-03-01T00:00:00.000Z",
      }),
    ];
    repo.findAllByLastOpened.mockResolvedValue(entities);

    const list = await service.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
    expect(list[1]!.lastOpenedAt).toBe("2025-03-01T00:00:00.000Z");
  });

  it("returns empty array when no workspaces", async () => {
    repo.findAllByLastOpened.mockResolvedValue([]);
    expect(await service.list()).toEqual([]);
  });
});

describe("WorkspaceService.getLastOpened", () => {
  it("returns the projected DTO when found", async () => {
    const entity = aWorkspace({ id: VALID_ID });
    repo.findLastOpened.mockResolvedValue(entity);
    const result = await service.getLastOpened();
    expect(result).not.toBeNull();
    expect(result!.id).toBe(VALID_ID);
  });

  it("returns null when none exists", async () => {
    repo.findLastOpened.mockResolvedValue(undefined);
    expect(await service.getLastOpened()).toBeNull();
  });
});

describe("WorkspaceService.getLastOpenedId", () => {
  it("returns the id from the repo", async () => {
    repo.findLastOpenedId.mockResolvedValue(VALID_ID);
    expect(await service.getLastOpenedId()).toBe(VALID_ID);
  });

  it("returns null when repo returns undefined", async () => {
    repo.findLastOpenedId.mockResolvedValue(undefined);
    expect(await service.getLastOpenedId()).toBeNull();
  });
});

// ─── register ────────────────────────────────────────────────

describe("WorkspaceService.register", () => {
  it("rejects an empty name with ZodError", async () => {
    await expect(
      service.register(aRegisterRequest({ name: "", workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects a name over 64 chars with ZodError", async () => {
    await expect(
      service.register(aRegisterRequest({ name: "a".repeat(65), workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects control characters in the name with ZodError", async () => {
    await expect(
      service.register(aRegisterRequest({ name: "foo\u0001bar", workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty workspaceDir with ZodError", async () => {
    await expect(service.register(aRegisterRequest({ workspaceDir: "" }))).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with ZodError (strict — id is server-minted, not caller-supplied)", async () => {
    const badInput = { name: "P", workspaceDir: ABS_DIR, id: VALID_ID } as unknown as Parameters<
      typeof service.register
    >[0];
    await expect(service.register(badInput)).rejects.toBeInstanceOf(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("throws WorkspacePathConflictError when path already exists (preflight check)", async () => {
    repo.findByPath.mockResolvedValue(
      aWorkspace({ id: OTHER_ID, workspaceDir: path.resolve(ABS_DIR) }),
    );
    await expect(
      service.register(aRegisterRequest({ workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("happy path: mints id, mkdirs, inserts, returns the Workspace", async () => {
    repo.findByPath.mockResolvedValue(undefined);
    repo.insert.mockResolvedValue(undefined);

    const view = await service.register(aRegisterRequest({ name: "Demo", workspaceDir: ABS_DIR }));

    const resolved = path.resolve(ABS_DIR);
    expect(view.name).toBe("Demo");
    expect(view.workspaceDir).toBe(resolved);
    expect(view.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(view.lastOpenedAt).toBe(view.createdAt);
    expect(mkdir).toHaveBeenCalledWith(resolved, { recursive: true });
    expect(mkdir).toHaveBeenCalledWith(path.join(resolved, "sessions"), { recursive: true });
    expect(mkdir).toHaveBeenCalledWith(path.join(resolved, "tasks"), { recursive: true });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: view.id,
        name: "Demo",
        workspaceDir: resolved,
        createdAt: expect.any(String),
        lastOpenedAt: expect.any(String),
      }),
    );
  });

  it("defaults workspaceDir to <defaultWorkspaceParent>/<id> when omitted", async () => {
    repo.findByPath.mockResolvedValue(undefined);
    repo.insert.mockResolvedValue(undefined);

    const view = await service.register(
      aRegisterRequest({ name: "Demo", workspaceDir: undefined }),
    );

    expect(view.workspaceDir).toBe(path.join(DEFAULT_PARENT, view.id));
    expect(mkdir).toHaveBeenCalledWith(path.join(DEFAULT_PARENT, view.id), { recursive: true });
  });

  it("resolves a relative workspaceDir", async () => {
    repo.findByPath.mockResolvedValue(undefined);
    repo.insert.mockResolvedValue(undefined);

    const view = await service.register(aRegisterRequest({ workspaceDir: "rel/path" }));

    expect(view.workspaceDir).toBe(path.resolve("rel/path"));
  });

  it("translateSqliteConstraintError: PRIMARYKEY → WorkspaceIdConflictError", async () => {
    repo.findByPath.mockResolvedValue(undefined);
    repo.insert.mockRejectedValue({
      code: "SQLITE_CONSTRAINT_PRIMARYKEY",
      message: "UNIQUE constraint failed: workspaces.id",
    });

    await expect(
      service.register(aRegisterRequest({ workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(WorkspaceIdConflictError);
  });

  it("translateSqliteConstraintError: workspace_dir UNIQUE → WorkspacePathConflictError", async () => {
    repo.findByPath.mockResolvedValueOnce(undefined);
    repo.insert.mockRejectedValue({
      code: "SQLITE_CONSTRAINT_UNIQUE",
      message: "UNIQUE constraint failed: workspaces.workspace_dir",
    });
    repo.findByPath.mockResolvedValueOnce(
      aWorkspace({ id: OTHER_ID, workspaceDir: path.resolve(ABS_DIR) }),
    );

    await expect(
      service.register(aRegisterRequest({ workspaceDir: ABS_DIR })),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
  });

  it("all input-format failures are instanceof ZodError", async () => {
    const cases = [
      { workspaceDir: "", name: "P" },
      { workspaceDir: ABS_DIR, name: "" },
      { workspaceDir: ABS_DIR, name: "a".repeat(65) },
      { workspaceDir: ABS_DIR, name: "ctrl\u0001" },
    ] as Parameters<typeof service.register>[0][];
    for (const input of cases) {
      await expect(service.register(input)).rejects.toBeInstanceOf(ZodError);
    }
  });
});

// ─── open ────────────────────────────────────────────────────

describe("WorkspaceService.open", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(service.open("not-a-uuid")).rejects.toBeInstanceOf(ZodError);
  });

  it("throws WorkspaceNotRegisteredError when not found", async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(service.open(VALID_ID)).rejects.toBeInstanceOf(WorkspaceNotRegisteredError);
  });

  it("calls repo.update with a new lastOpenedAt", async () => {
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID }));
    repo.update.mockResolvedValue(undefined);

    await service.open(VALID_ID);

    expect(repo.update).toHaveBeenCalledWith(VALID_ID, { lastOpenedAt: expect.any(String) });
  });
});

// ─── rename ──────────────────────────────────────────────────

describe("WorkspaceService.rename", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(service.rename("bad", { name: "X" })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects an invalid new name with ZodError", async () => {
    await expect(service.rename(VALID_ID, { name: "" })).rejects.toBeInstanceOf(ZodError);
  });

  it("throws WorkspaceNotRegisteredError when not found", async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(service.rename(VALID_ID, { name: "New" })).rejects.toBeInstanceOf(
      WorkspaceNotRegisteredError,
    );
  });

  it("no-op when name is unchanged — repo.update NOT called", async () => {
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID, name: "Same" }));
    await service.rename(VALID_ID, { name: "Same" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("happy path: updates the name", async () => {
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID, name: "Old" }));
    repo.update.mockResolvedValue(undefined);

    await service.rename(VALID_ID, { name: "New" });
    expect(repo.update).toHaveBeenCalledWith(VALID_ID, { name: "New" });
  });
});

// ─── unregister ──────────────────────────────────────────────

describe("WorkspaceService.unregister", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(service.unregister("bad")).rejects.toBeInstanceOf(ZodError);
  });

  it("resolves without throw when not found (idempotent) — repo.delete NOT called", async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(service.unregister(VALID_ID)).resolves.toBeUndefined();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("purge=true → rm called for sessions+tasks, then repo.delete", async () => {
    const wsDir = ABS_DIR;
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID, workspaceDir: wsDir }));
    repo.delete.mockResolvedValue(undefined);

    await service.unregister(VALID_ID, { purge: true });

    const resolved = path.resolve(wsDir);
    expect(rm).toHaveBeenCalledWith(path.join(resolved, "sessions"), {
      recursive: true,
      force: true,
    });
    expect(rm).toHaveBeenCalledWith(path.join(resolved, "tasks"), { recursive: true, force: true });
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });

  it("purge=false → rm NOT called, repo.delete called", async () => {
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID, workspaceDir: ABS_DIR }));
    repo.delete.mockResolvedValue(undefined);

    await service.unregister(VALID_ID, { purge: false });

    expect(rm).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });

  it("purge defaults to false (rm NOT called)", async () => {
    repo.findById.mockResolvedValue(aWorkspace({ id: VALID_ID, workspaceDir: ABS_DIR }));
    repo.delete.mockResolvedValue(undefined);

    await service.unregister(VALID_ID);

    expect(rm).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });
});

// ─── projectWorkspace ────────────────────────────────────────

describe("projectWorkspace", () => {
  it("copies all fields from the entity to the DTO", () => {
    const entity = aWorkspace({ lastOpenedAt: "2025-06-01T00:00:00.000Z" });
    const dto = projectWorkspace(entity);

    expect(dto.id).toBe(entity.id);
    expect(dto.name).toBe(entity.name);
    expect(dto.workspaceDir).toBe(entity.workspaceDir);
    expect(dto.createdAt).toBe(entity.createdAt);
    expect(dto.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
  });

  it("coalesces null lastOpenedAt to createdAt", () => {
    const entity = aWorkspace({ lastOpenedAt: null, createdAt: "2025-03-15T12:00:00.000Z" });
    const dto = projectWorkspace(entity);

    expect(dto.lastOpenedAt).toBe("2025-03-15T12:00:00.000Z");
  });

  it("passes through a non-null lastOpenedAt unchanged", () => {
    const entity = aWorkspace({
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });
    const dto = projectWorkspace(entity);

    expect(dto.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
  });
});
