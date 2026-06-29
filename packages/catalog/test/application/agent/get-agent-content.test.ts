import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetAgentContentUseCase } from "../../../src/application/agent/get-agent-content.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");

let agentRepo: MockProxy<AgentRepository>;
let useCase: GetAgentContentUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  useCase = new GetAgentContentUseCase({ agentRepo });
});

describe("GetAgentContentUseCase — read paths", () => {
  it("returns anchor content for the requested agent", async () => {
    agentRepo.getAnchor.mockReturnValue(okAsync("# triage"));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(agentRepo.getAnchor).toHaveBeenCalledWith(AGENT_ID);
    expect(dto).toEqual({ id: AGENT_ID, content: "# triage" });
  });
});

describe("GetAgentContentUseCase — error channel", () => {
  it("propagates AgentNotFound from repo.getAnchor", async () => {
    agentRepo.getAnchor.mockReturnValue(errAsync({ type: "AgentNotFound", fqn: AGENT_ID }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
  });

  it("propagates DatabaseUnavailable from repo.getAnchor", async () => {
    const cause = new Error("disk");
    agentRepo.getAnchor.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
