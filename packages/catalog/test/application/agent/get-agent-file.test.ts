import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetAgentFileUseCase } from "../../../src/application/agent/get-agent-file.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");

let agentRepo: MockProxy<AgentRepository>;
let useCase: GetAgentFileUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  useCase = new GetAgentFileUseCase({ agentRepo });
});

describe("GetAgentFileUseCase — read paths", () => {
  it("returns a matching file buffer", async () => {
    const content = Buffer.from("# triage");
    agentRepo.getFile.mockReturnValue(okAsync(content));

    const buf = (await useCase.execute({ id: AGENT_ID, relPath: "AGENTS.md" }))._unsafeUnwrap();

    expect(agentRepo.getFile).toHaveBeenCalledWith(AGENT_ID, "AGENTS.md");
    expect(buf).toBe(content);
  });

  it("returns null when the file is absent", async () => {
    agentRepo.getFile.mockReturnValue(okAsync(null));

    const buf = (await useCase.execute({ id: AGENT_ID, relPath: "missing.md" }))._unsafeUnwrap();

    expect(buf).toBeNull();
  });
});

describe("GetAgentFileUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.getFile", async () => {
    const cause = new Error("disk");
    agentRepo.getFile.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID, relPath: "AGENTS.md" });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
