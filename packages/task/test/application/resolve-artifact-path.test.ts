import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ResolveArtifactPathUseCase } from "../../src/application/resolve-artifact-path.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let useCase: ResolveArtifactPathUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new ResolveArtifactPathUseCase({ repository: repo });
});

function succeeded(artifacts: readonly string[]): TaskEntity {
  return TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT })
    .complete({ output: null, artifacts }, { now: CREATED_AT })
    ._unsafeUnwrap();
}

describe("ResolveArtifactPathUseCase", () => {
  it("resolves a whitelisted artifact by basename", async () => {
    repo.findById.mockReturnValue(okAsync(succeeded(["/w/artifact/report.html"])));
    const res = (await useCase.execute({ id: ID, name: "report.html" }))._unsafeUnwrap();
    expect(res).toBe("/w/artifact/report.html");
  });

  it("returns null for a name not on the whitelist", async () => {
    repo.findById.mockReturnValue(okAsync(succeeded(["/w/artifact/report.html"])));
    expect((await useCase.execute({ id: ID, name: "secret.txt" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a running task", async () => {
    repo.findById.mockReturnValue(
      okAsync(TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT })),
    );
    expect((await useCase.execute({ id: ID, name: "x" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for an absent task", async () => {
    repo.findById.mockReturnValue(okAsync(undefined));
    expect((await useCase.execute({ id: ID, name: "x" }))._unsafeUnwrap()).toBeNull();
  });
});
