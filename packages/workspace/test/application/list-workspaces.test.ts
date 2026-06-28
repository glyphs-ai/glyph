import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { ListWorkspacesUseCase } from "../../src/application/list-workspaces.js";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

let repo: MockProxy<WorkspaceRepository>;
let useCase: ListWorkspacesUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findAllByLastOpened.mockReturnValue(okAsync([]));
  useCase = new ListWorkspacesUseCase({ repo });
});

describe("ListWorkspacesUseCase — input validation", () => {
  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ extra: "x" } as unknown as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("ListWorkspacesUseCase — read paths", () => {
  it("returns an empty array when no workspaces are registered", async () => {
    const res = await useCase.execute({});
    expect(res._unsafeUnwrap()).toEqual([]);
  });

  it("projects entities preserving repo order (lastOpenedAt DESC)", async () => {
    repo.findAllByLastOpened.mockReturnValue(
      okAsync([
        new WorkspaceEntity({
          id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
          name: "A" as WorkspaceName,
          workspaceDir: "/a",
          createdAt: "2025-01-01T00:00:00.000Z",
          lastOpenedAt: "2025-06-01T00:00:00.000Z",
        }),
        new WorkspaceEntity({
          id: "22222222-2222-4222-8222-222222222222" as WorkspaceId,
          name: "B" as WorkspaceName,
          workspaceDir: "/b",
          createdAt: "2025-03-01T00:00:00.000Z",
          lastOpenedAt: null,
        }),
      ]),
    );
    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe("A");
    expect(list[0]?.lastOpenedAt).toBe("2025-06-01T00:00:00.000Z");
    expect(list[1]?.name).toBe("B");
    // null lastOpenedAt coalesced to createdAt at the projection boundary.
    expect(list[1]?.lastOpenedAt).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("ListWorkspacesUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from repo.findAllByLastOpened", async () => {
    repo.findAllByLastOpened.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
