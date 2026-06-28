import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { RenameWorkspaceUseCase } from "../../src/application/rename-workspace.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const OLD_NAME = "Old" as WorkspaceName;
const NEW_NAME = "New" as WorkspaceName;

function entity(name: WorkspaceName) {
  return new WorkspaceEntity({
    id: VALID_ID,
    name,
    workspaceDir: "/x",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastOpenedAt: null,
  });
}

let repo: MockProxy<WorkspaceRepository>;
let useCase: RenameWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findById.mockReturnValue(okAsync(undefined));
  repo.save.mockReturnValue(okAsync(undefined));
  useCase = new RenameWorkspaceUseCase({ repo });
});

describe("RenameWorkspaceUseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as WorkspaceId, name: NEW_NAME })).toThrow(ZodError);
  });

  it("rejects an empty name with ZodError", async () => {
    expect(() => useCase.execute({ id: VALID_ID, name: "" as WorkspaceName })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, name: NEW_NAME, extra: 1 } as Parameters<
        typeof useCase.execute
      >[0]),
    ).toThrow(ZodError);
  });
});

describe("RenameWorkspaceUseCase — error channel", () => {
  it("WorkspaceNotRegistered when findById returns undefined", async () => {
    const res = await useCase.execute({ id: VALID_ID, name: NEW_NAME });
    const err = res._unsafeUnwrapErr();
    expect(err.type).toBe("WorkspaceNotRegistered");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from repo.findById", async () => {
    repo.findById.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID, name: NEW_NAME });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });

  it("DatabaseUnavailable propagated from repo.save", async () => {
    repo.findById.mockReturnValue(okAsync(entity(OLD_NAME)));
    repo.save.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: new Error("x") }));
    const res = await useCase.execute({ id: VALID_ID, name: NEW_NAME });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});

describe("RenameWorkspaceUseCase — happy path", () => {
  it("mutates entity name and saves", async () => {
    const e = entity(OLD_NAME);
    repo.findById.mockReturnValue(okAsync(e));

    const res = await useCase.execute({ id: VALID_ID, name: NEW_NAME });
    expect(res.isOk()).toBe(true);
    expect(e.name).toBe(NEW_NAME);
    expect(repo.save).toHaveBeenCalledWith(e);
  });

  it("noop on same name: entity.rename returns without mutation, but save still called (single linear flow)", async () => {
    const e = entity(NEW_NAME);
    repo.findById.mockReturnValue(okAsync(e));

    const res = await useCase.execute({ id: VALID_ID, name: NEW_NAME });
    expect(res.isOk()).toBe(true);
    expect(e.name).toBe(NEW_NAME);
    expect(repo.save).toHaveBeenCalledWith(e);
  });
});
