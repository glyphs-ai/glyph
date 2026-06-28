import path from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { UnregisterWorkspaceUseCase } from "../../src/application/unregister-workspace.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceProvisioner } from "../../src/domain/workspace-provisioner.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const WS_DIR = process.platform === "win32" ? "C:\\workspaces\\demo" : "/workspaces/demo";

function entity() {
  return new WorkspaceEntity({
    id: VALID_ID,
    name: "Demo" as WorkspaceName,
    workspaceDir: WS_DIR,
    createdAt: "2025-01-01T00:00:00.000Z",
    lastOpenedAt: "2025-01-02T00:00:00.000Z",
  });
}

let repo: MockProxy<WorkspaceRepository>;
let provisioner: MockProxy<WorkspaceProvisioner>;
let useCase: UnregisterWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  provisioner = mock<WorkspaceProvisioner>();
  repo.findById.mockReturnValue(okAsync(undefined));
  repo.delete.mockReturnValue(okAsync(undefined));
  provisioner.teardown.mockReturnValue(okAsync(undefined));
  useCase = new UnregisterWorkspaceUseCase({ repo, provisioner });
});

describe("UnregisterWorkspaceUseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as WorkspaceId })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, extra: 1 } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("UnregisterWorkspaceUseCase — idempotent on unknown id", () => {
  it("Ok + no teardown + no delete when findById returns undefined", async () => {
    const res = await useCase.execute({ id: VALID_ID });
    expect(res.isOk()).toBe(true);
    expect(provisioner.teardown).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe("UnregisterWorkspaceUseCase — purge=false (default)", () => {
  it("calls repo.delete only, no teardown", async () => {
    repo.findById.mockReturnValue(okAsync(entity()));
    const res = await useCase.execute({ id: VALID_ID });
    expect(res.isOk()).toBe(true);
    expect(provisioner.teardown).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });

  it("explicit purge=false behaves the same as default", async () => {
    repo.findById.mockReturnValue(okAsync(entity()));
    const res = await useCase.execute({ id: VALID_ID, purge: false });
    expect(res.isOk()).toBe(true);
    expect(provisioner.teardown).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });
});

describe("UnregisterWorkspaceUseCase — purge=true", () => {
  it("teardown then delete, in order", async () => {
    repo.findById.mockReturnValue(okAsync(entity()));
    const calls: string[] = [];
    provisioner.teardown.mockImplementation((dir) => {
      calls.push(`teardown:${dir}`);
      return okAsync(undefined);
    });
    repo.delete.mockImplementation((id) => {
      calls.push(`delete:${id}`);
      return okAsync(undefined);
    });

    const res = await useCase.execute({ id: VALID_ID, purge: true });
    expect(res.isOk()).toBe(true);
    const resolved = path.resolve(WS_DIR);
    expect(calls).toEqual([`teardown:${resolved.replace(/\\/g, "\\")}`, `delete:${VALID_ID}`]);
  });
});

describe("UnregisterWorkspaceUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from repo.findById", async () => {
    repo.findById.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID, purge: true });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(provisioner.teardown).not.toHaveBeenCalled();
  });

  it("ProvisioningFailed propagated from teardown (purge=true)", async () => {
    repo.findById.mockReturnValue(okAsync(entity()));
    provisioner.teardown.mockReturnValue(
      errAsync({ type: "ProvisioningFailed", workspaceDir: WS_DIR, cause: new Error("EACCES") }),
    );
    const res = await useCase.execute({ id: VALID_ID, purge: true });
    expect(res._unsafeUnwrapErr().type).toBe("ProvisioningFailed");
    // delete NOT called: teardown failed first, single linear chain.
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from repo.delete", async () => {
    repo.findById.mockReturnValue(okAsync(entity()));
    repo.delete.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
