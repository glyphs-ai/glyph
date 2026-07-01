import type { Runtime, RuntimeRegistry, RuntimeSessionMetadata } from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSessionUseCase } from "../../src/application/get-session.js";
import { SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { SessionRepository } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");
const WORKDIR = `/ws/sessions/${ID}`;

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
let useCase: GetSessionUseCase;

beforeEach(() => {
  repo = mock<SessionRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  sandbox = mock<SessionSandbox>();
  runtimeRegistry.get.mockReturnValue(ok(runtime));
  runtime.readMetadata.mockReturnValue(okAsync(null));
  sandbox.resolve.mockReturnValue(WORKDIR);
  useCase = new GetSessionUseCase({ repo, runtimeRegistry, sandbox });
});

describe("GetSessionUseCase", () => {
  it("returns null when the session is absent", async () => {
    repo.findById.mockReturnValue(okAsync(undefined));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the session's runtime is no longer registered", async () => {
    repo.findById.mockReturnValue(okAsync(entity("rsid-1")));
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("projects the base view when there is no runtime session yet", async () => {
    repo.findById.mockReturnValue(okAsync(entity(null)));
    const view = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(view).toEqual({
      id: ID,
      workdir: WORKDIR,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: null,
      createdAt: "2026-05-08T01:05:00.000Z",
      lastActiveAt: null,
      preview: null,
      lastLaunchMode: null,
    });
    expect(runtime.readMetadata).not.toHaveBeenCalled();
  });

  it("refreshes lastActiveAt + preview from live runtime metadata", async () => {
    repo.findById.mockReturnValue(okAsync(entity("rsid-1")));
    const meta: RuntimeSessionMetadata = {
      title: "Draft the post",
      userTitled: false,
      lastActiveAt: "2026-05-08T02:00:00.000Z",
    };
    runtime.readMetadata.mockReturnValue(okAsync(meta));
    const view = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(view?.preview).toBe("Draft the post");
    expect(view?.lastActiveAt).toBe("2026-05-08T02:00:00.000Z");
  });

  it("propagates DatabaseUnavailable from the repository", async () => {
    repo.findById.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: null }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
