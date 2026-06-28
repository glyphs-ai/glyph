import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { GetLastOpenedWorkspaceIdUseCase } from "../../src/application/get-last-opened-workspace-id.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

let repo: MockProxy<WorkspaceRepository>;
let useCase: GetLastOpenedWorkspaceIdUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.findLastOpenedId.mockReturnValue(okAsync(undefined));
  useCase = new GetLastOpenedWorkspaceIdUseCase({ repo });
});

describe("GetLastOpenedWorkspaceIdUseCase — input validation", () => {
  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ extra: 1 } as unknown as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("GetLastOpenedWorkspaceIdUseCase — read paths", () => {
  it("returns { id: null } when the registry is empty", async () => {
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual({ id: null });
  });

  it("returns { id } when the registry has at least one workspace", async () => {
    repo.findLastOpenedId.mockReturnValue(okAsync(VALID_ID));
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual({ id: VALID_ID });
  });
});

describe("GetLastOpenedWorkspaceIdUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from repo.findLastOpenedId", async () => {
    repo.findLastOpenedId.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
