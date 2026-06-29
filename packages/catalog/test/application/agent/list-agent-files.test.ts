import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListAgentFilesUseCase } from "../../../src/application/agent/list-agent-files.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");

let agentRepo: MockProxy<AgentRepository>;
let useCase: ListAgentFilesUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  useCase = new ListAgentFilesUseCase({ agentRepo });
});

describe("ListAgentFilesUseCase — read paths", () => {
  it("returns the repository file entries", async () => {
    const entries = [
      { relPath: "AGENTS.md", size: 9 },
      { relPath: "references/readme.md", size: 12 },
    ];
    agentRepo.listFilePaths.mockReturnValue(okAsync(entries));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(agentRepo.listFilePaths).toHaveBeenCalledWith(AGENT_ID);
    expect(dto).toEqual(entries);
  });
});

describe("ListAgentFilesUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.listFilePaths", async () => {
    const cause = new Error("disk");
    agentRepo.listFilePaths.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
