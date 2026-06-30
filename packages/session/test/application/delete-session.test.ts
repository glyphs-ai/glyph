import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime-v2";
import { errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DeleteSessionUseCase } from "../../src/application/delete-session.js";
import { SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { SessionRepository } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");

function entity(runtimeSessionId: string | null): SessionEntity {
  return new SessionEntity({
    id: ID,
    agent: "public/demo",
    runtime: "copilot",
    createdAt: "2026-05-08T01:05:00.000Z",
    runtimeSessionId,
    lastLaunchMode: null,
  });
}

let repo: MockProxy<SessionRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime>;
let sandbox: MockProxy<SessionSandbox>;
let useCase: DeleteSessionUseCase;

beforeEach(() => {
  repo = mock<SessionRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  sandbox = mock<SessionSandbox>();
  repo.delete.mockReturnValue(okAsync(undefined));
  runtimeRegistry.get.mockReturnValue(ok(runtime));
  runtime.deleteState.mockReturnValue(okAsync(undefined));
  sandbox.remove.mockReturnValue(okAsync(undefined));
  useCase = new DeleteSessionUseCase({ repo, runtimeRegistry, sandbox });
});

describe("DeleteSessionUseCase", () => {
  it("archive removes only the registry row", async () => {
    repo.get.mockReturnValue(okAsync(entity("rsid-1")));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeUndefined();
    expect(repo.delete).toHaveBeenCalledWith(ID);
    expect(runtime.deleteState).not.toHaveBeenCalled();
    expect(sandbox.remove).not.toHaveBeenCalled();
  });

  it("purge drops runtime state, the sandbox, then the row", async () => {
    repo.get.mockReturnValue(okAsync(entity("rsid-1")));
    await useCase.execute({ id: ID, purge: true });
    expect(runtime.deleteState).toHaveBeenCalledWith("rsid-1");
    expect(sandbox.remove).toHaveBeenCalledWith(ID);
    expect(repo.delete).toHaveBeenCalledWith(ID);
  });

  it("purge skips runtime-state deletion when there is no runtime session", async () => {
    repo.get.mockReturnValue(okAsync(entity(null)));
    await useCase.execute({ id: ID, purge: true });
    expect(runtime.deleteState).not.toHaveBeenCalled();
    expect(sandbox.remove).toHaveBeenCalledWith(ID);
  });

  it("propagates SessionNotFound and deletes nothing", async () => {
    repo.get.mockReturnValue(errAsync({ type: "SessionNotFound", id: ID }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("SessionNotFound");
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
