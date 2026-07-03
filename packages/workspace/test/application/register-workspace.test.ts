import path from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import {
  type RegisterWorkspaceRequest,
  RegisterWorkspaceUseCase,
} from "../../src/application/register-workspace.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceProvisioner } from "../../src/domain/workspace-provisioner.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";
import type { WorkspaceQueries } from "../../src/infrastructure/drizzle/workspace-queries.js";

const OTHER_ID = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const ABS_DIR = process.platform === "win32" ? "C:\\workspaces\\project" : "/workspaces/project";
const DEFAULT_PARENT = process.platform === "win32" ? "C:\\glyph\\workspaces" : "/glyph/workspaces";

function req(name: string, workspaceDir?: string): RegisterWorkspaceRequest {
  return { name: name as WorkspaceName, ...(workspaceDir !== undefined ? { workspaceDir } : {}) };
}

let repo: MockProxy<WorkspaceRepository>;
let query: MockProxy<WorkspaceQueries>;
let provisioner: MockProxy<WorkspaceProvisioner>;
let useCase: RegisterWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  query = mock<WorkspaceQueries>();
  provisioner = mock<WorkspaceProvisioner>();
  query.query.mockReturnValue(okAsync(undefined));
  repo.save.mockReturnValue(okAsync(undefined));
  provisioner.provision.mockReturnValue(okAsync(undefined));
  useCase = new RegisterWorkspaceUseCase({
    repo,
    query,
    provisioner,
    defaultWorkspaceParent: DEFAULT_PARENT,
  });
});

describe("RegisterWorkspaceUseCase — input validation (ZodError)", () => {
  const cases: { label: string; input: unknown }[] = [
    { label: "empty name", input: { name: "", workspaceDir: ABS_DIR } },
    { label: "name > 64 chars", input: { name: "a".repeat(65), workspaceDir: ABS_DIR } },
    { label: "control chars in name", input: { name: "foo\u0001bar", workspaceDir: ABS_DIR } },
    { label: "empty workspaceDir", input: { name: "x", workspaceDir: "" } },
    { label: "unknown key (strict)", input: { name: "x", workspaceDir: ABS_DIR, id: "any" } },
  ];
  for (const { label, input } of cases) {
    it(`rejects ${label}`, async () => {
      expect(() => useCase.execute(input as Parameters<typeof useCase.execute>[0])).toThrow(
        ZodError,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  }
});

describe("RegisterWorkspaceUseCase — happy path", () => {
  it("mints id, resolves dir, provisions, saves, returns Workspace", async () => {
    const res = await useCase.execute(req("Demo", ABS_DIR));
    const view = res._unsafeUnwrap();

    const resolved = path.resolve(ABS_DIR);
    expect(view.name).toBe("Demo");
    expect(view.workspaceDir).toBe(resolved);
    expect(view.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(view.lastOpenedAt).toBe(view.createdAt);
    expect(provisioner.provision).toHaveBeenCalledWith(resolved);
    expect(repo.save).toHaveBeenCalledWith(
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
    const res = await useCase.execute(req("Demo"));
    const view = res._unsafeUnwrap();
    expect(view.workspaceDir).toBe(path.join(DEFAULT_PARENT, view.id));
    expect(provisioner.provision).toHaveBeenCalledWith(path.join(DEFAULT_PARENT, view.id));
  });

  it("resolves a relative workspaceDir to absolute", async () => {
    const res = await useCase.execute(req("Demo", "rel/path"));
    expect(res._unsafeUnwrap().workspaceDir).toBe(path.resolve("rel/path"));
  });
});

describe("RegisterWorkspaceUseCase — error channel", () => {
  it("WorkspacePathConflict from pre-flight query", async () => {
    query.query.mockReturnValue(okAsync({ id: OTHER_ID }));
    const res = await useCase.execute(req("Demo", ABS_DIR));
    const err = res._unsafeUnwrapErr();
    expect(err.type).toBe("WorkspacePathConflict");
    if (err.type === "WorkspacePathConflict") expect(err.existingId).toBe(OTHER_ID);
    expect(provisioner.provision).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("WorkspaceIdConflict propagated from repo.save (PRIMARY KEY race)", async () => {
    repo.save.mockReturnValue(errAsync({ type: "WorkspaceIdConflict", id: "X" as WorkspaceId }));
    const res = await useCase.execute(req("Demo", ABS_DIR));
    expect(res._unsafeUnwrapErr().type).toBe("WorkspaceIdConflict");
  });

  it("WorkspacePathConflict propagated from repo.save (UNIQUE race)", async () => {
    repo.save.mockReturnValue(
      errAsync({
        type: "WorkspacePathConflict",
        workspaceDir: path.resolve(ABS_DIR),
        existingId: OTHER_ID,
      }),
    );
    const res = await useCase.execute(req("Demo", ABS_DIR));
    expect(res._unsafeUnwrapErr().type).toBe("WorkspacePathConflict");
  });

  it("ProvisioningFailed propagated from provisioner", async () => {
    provisioner.provision.mockReturnValue(
      errAsync({
        type: "ProvisioningFailed",
        workspaceDir: path.resolve(ABS_DIR),
        cause: new Error("EACCES"),
      }),
    );
    const res = await useCase.execute(req("Demo", ABS_DIR));
    expect(res._unsafeUnwrapErr().type).toBe("ProvisioningFailed");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from query", async () => {
    query.query.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("disk corrupt") }),
    );
    const res = await useCase.execute(req("Demo", ABS_DIR));
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
