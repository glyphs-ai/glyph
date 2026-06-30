import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime-v2";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListSessionsUseCase } from "../../src/application/list-sessions.js";
import { SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { SessionRepository } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";

const NEWER = SessionIdSchema.parse("20260510-aaaaaaaa");
const OLDER = SessionIdSchema.parse("20260508-bbbbbbbb");
const UNREG = SessionIdSchema.parse("20260509-cccccccc");

function entity(id: string, runtime: string, createdAt: string): SessionEntity {
  return new SessionEntity({
    id: SessionIdSchema.parse(id),
    agent: "public/demo",
    runtime,
    createdAt,
    runtimeSessionId: null,
    lastLaunchMode: null,
  });
}

let repo: MockProxy<SessionRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime>;
let sandbox: MockProxy<SessionSandbox>;
let useCase: ListSessionsUseCase;

beforeEach(() => {
  repo = mock<SessionRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  sandbox = mock<SessionSandbox>();
  runtimeRegistry.get.mockImplementation((kind) =>
    kind === "copilot" ? ok(runtime) : err({ type: "UnknownRuntime", runtime: kind }),
  );
  runtime.readMetadata.mockReturnValue(okAsync(null));
  sandbox.resolve.mockImplementation((id) => `/ws/sessions/${id}`);
  useCase = new ListSessionsUseCase({ repo, runtimeRegistry, sandbox });
});

describe("ListSessionsUseCase", () => {
  it("drops sessions whose runtime is unregistered and sorts newest-first", async () => {
    repo.findAll.mockReturnValue(
      okAsync([
        entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"),
        entity(UNREG, "gemini", "2026-05-09T00:00:00.000Z"),
        entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z"),
      ]),
    );
    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER, OLDER]);
  });

  it("forwards agent + createdSince filters to the repository", async () => {
    repo.findAll.mockReturnValue(okAsync([]));
    await useCase.execute({ agent: "public/demo", createdSince: "2026-05-01T00:00:00.000Z" });
    expect(repo.findAll).toHaveBeenCalledWith({
      agent: "public/demo",
      createdSince: "2026-05-01T00:00:00.000Z",
    });
  });

  it("activeSince filters never-active rows on their createdAt", async () => {
    repo.findAll.mockReturnValue(
      okAsync([
        entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"),
        entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z"),
      ]),
    );
    const list = (
      await useCase.execute({ activeSince: "2026-05-09T00:00:00.000Z" })
    )._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER]);
  });

  it("propagates DatabaseUnavailable from the repository", async () => {
    repo.findAll.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: null }));
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
