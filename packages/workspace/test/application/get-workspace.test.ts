import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { GetWorkspaceUseCase } from "../../src/application/get-workspace.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

let repo: MockProxy<WorkspaceRepository>;
let useCase: GetWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findById.mockReturnValue(okAsync(undefined));
  useCase = new GetWorkspaceUseCase({ repo });
});

describe("GetWorkspaceUseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as WorkspaceId })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, extra: "x" } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("GetWorkspaceUseCase — read paths", () => {
  it("returns null when the workspace is not registered", async () => {
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrap()).toBeNull();
  });

  it("returns the projected Workspace DTO when found", async () => {
    repo.findById.mockReturnValue(
      okAsync(
        new WorkspaceEntity({
          id: VALID_ID,
          name: "Demo" as WorkspaceName,
          workspaceDir: "/x",
          createdAt: "2025-01-01T00:00:00.000Z",
          lastOpenedAt: "2025-06-01T00:00:00.000Z",
        }),
      ),
    );
    const dto = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(dto).toEqual({
      id: VALID_ID,
      name: "Demo",
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });
  });

  it("coalesces null lastOpenedAt to createdAt at the projection boundary", async () => {
    repo.findById.mockReturnValue(
      okAsync(
        new WorkspaceEntity({
          id: VALID_ID,
          name: "Demo" as WorkspaceName,
          workspaceDir: "/x",
          createdAt: "2025-01-01T00:00:00.000Z",
          lastOpenedAt: null,
        }),
      ),
    );
    const dto = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(dto?.lastOpenedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("GetWorkspaceUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from repo.findById", async () => {
    repo.findById.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
