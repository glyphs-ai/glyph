import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { UninstallAgentUseCase } from "../../../src/application/agent/uninstall-agent.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");

function agentEntity(overrides: Partial<AgentEntityArgs> = {}): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: "file:///catalog/agents/triage",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps: [], agents: [] },
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
}

let agentRepo: MockProxy<AgentRepository>;
let useCase: UninstallAgentUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  agentRepo.get.mockReturnValue(okAsync(agentEntity()));
  agentRepo.existsUsingAgent.mockReturnValue(okAsync(false));
  agentRepo.delete.mockReturnValue(okAsync(undefined));
  useCase = new UninstallAgentUseCase({ agentRepo });
});

describe("UninstallAgentUseCase — happy path", () => {
  it("deletes an installed agent when no installed agent depends on it", async () => {
    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrap()).toBeUndefined();
    expect(agentRepo.get).toHaveBeenCalledWith(AGENT_ID);
    expect(agentRepo.existsUsingAgent).toHaveBeenCalledWith(AGENT_ID);
    expect(agentRepo.delete).toHaveBeenCalledWith(AGENT_ID);
  });
});

describe("UninstallAgentUseCase — error channel", () => {
  it("propagates AgentNotFound from repo.get", async () => {
    agentRepo.get.mockReturnValue(errAsync({ type: "AgentNotFound", fqn: AGENT_ID }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
    expect(agentRepo.existsUsingAgent).not.toHaveBeenCalled();
    expect(agentRepo.delete).not.toHaveBeenCalled();
  });

  it("returns HasDependents when another agent references the target", async () => {
    agentRepo.existsUsingAgent.mockReturnValue(okAsync(true));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: AGENT_ID });
    expect(agentRepo.delete).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from existsUsingAgent", async () => {
    const cause = new Error("disk");
    agentRepo.existsUsingAgent.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
    expect(agentRepo.delete).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from delete", async () => {
    const cause = new Error("disk");
    agentRepo.delete.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
