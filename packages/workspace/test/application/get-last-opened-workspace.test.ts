import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { GetLastOpenedWorkspaceUseCase } from "../../src/application/get-last-opened-workspace.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

let repo: MockProxy<WorkspaceRepository>;
let useCase: GetLastOpenedWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findLastOpened.mockReturnValue(okAsync(undefined));
  useCase = new GetLastOpenedWorkspaceUseCase({ repo });
});

describe("GetLastOpenedWorkspaceUseCase — input validation", () => {
  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ extra: 1 } as unknown as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("GetLastOpenedWorkspaceUseCase — read paths", () => {
  it("returns null when registry is empty", async () => {
    expect((await useCase.execute({}))._unsafeUnwrap()).toBeNull();
  });

  it("returns the projected Workspace DTO when found", async () => {
    repo.findLastOpened.mockReturnValue(
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
    const dto = (await useCase.execute({}))._unsafeUnwrap();
    expect(dto?.id).toBe(VALID_ID);
    expect(dto?.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
  });

  it("coalesces null lastOpenedAt to createdAt at the projection boundary", async () => {
    repo.findLastOpened.mockReturnValue(
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
    const dto = (await useCase.execute({}))._unsafeUnwrap();
    expect(dto?.lastOpenedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("GetLastOpenedWorkspaceUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from repo.findLastOpened", async () => {
    repo.findLastOpened.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
