import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { OpenWorkspaceUseCase } from "../../src/application/open-workspace.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

let repo: MockProxy<WorkspaceRepository>;
let useCase: OpenWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findById.mockReturnValue(okAsync(undefined));
  repo.save.mockReturnValue(okAsync(undefined));
  useCase = new OpenWorkspaceUseCase({ repo });
});

describe("OpenWorkspaceUseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "not-a-uuid" as WorkspaceId })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, extra: "x" } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("OpenWorkspaceUseCase — error channel", () => {
  it("WorkspaceNotRegistered when findById returns undefined", async () => {
    const res = await useCase.execute({ id: VALID_ID });
    const err = res._unsafeUnwrapErr();
    expect(err.type).toBe("WorkspaceNotRegistered");
    if (err.type === "WorkspaceNotRegistered") expect(err.id).toBe(VALID_ID);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from repo.findById", async () => {
    repo.findById.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });

  it("DatabaseUnavailable propagated from repo.save", async () => {
    repo.findById.mockReturnValue(
      okAsync(
        new WorkspaceEntity({
          id: VALID_ID,
          name: "X" as WorkspaceName,
          workspaceDir: "/x",
          createdAt: "2025-01-01T00:00:00.000Z",
          lastOpenedAt: null,
        }),
      ),
    );
    repo.save.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }));
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});

describe("OpenWorkspaceUseCase — happy path", () => {
  it("calls entity.markOpened, then repo.save with the mutated entity", async () => {
    const entity = new WorkspaceEntity({
      id: VALID_ID,
      name: "X" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    });
    repo.findById.mockReturnValue(okAsync(entity));

    const before = new Date().toISOString();
    const res = await useCase.execute({ id: VALID_ID });
    expect(res.isOk()).toBe(true);

    expect(repo.save).toHaveBeenCalledWith(entity);
    // markOpened assigns a fresh ISO timestamp.
    expect(entity.lastOpenedAt).not.toBeNull();
    expect(entity.lastOpenedAt!).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entity.lastOpenedAt! >= before).toBe(true);
  });
});
