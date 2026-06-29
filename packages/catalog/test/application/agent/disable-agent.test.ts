import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DisableAgentUseCase } from "../../../src/application/agent/disable-agent.js";
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

function agentDto(entity: AgentEntity) {
  const dependencies =
    entity.dependencyRefs.skills.length > 0 ||
    entity.dependencyRefs.mcps.length > 0 ||
    entity.dependencyRefs.agents.length > 0
      ? {
          ...(entity.dependencyRefs.skills.length > 0
            ? { skills: entity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.mcps.length > 0
            ? { mcps: entity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.agents.length > 0
            ? { agents: entity.dependencyRefs.agents.map((fqn) => ({ fqn })) }
            : {}),
        }
      : undefined;
  return {
    fqn: entity.fqn,
    origin: entity.origin,
    description: entity.description,
    version: entity.version,
    ...(entity.prereqs !== undefined ? { prereqs: entity.prereqs } : {}),
    prereqsAck: entity.prereqsAck,
    disabledByUser: entity.disabledByUser,
    installedAt: entity.installedAt,
    updatedAt: entity.updatedAt,
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

let agentRepo: MockProxy<AgentRepository>;
let useCase: DisableAgentUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  agentRepo.save.mockReturnValue(okAsync(undefined));
  useCase = new DisableAgentUseCase({ agentRepo });
});

describe("DisableAgentUseCase — happy path", () => {
  it("disables an enabled agent, saves it, and returns the projected Agent DTO", async () => {
    const entity = agentEntity();
    agentRepo.get.mockReturnValue(okAsync(entity));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(entity.disabledByUser).toBe(true);
    expect(agentRepo.save).toHaveBeenCalledWith(entity);
    expect(dto).toEqual(agentDto(entity));
  });

  it("is idempotent when the agent is already disabled", async () => {
    const entity = agentEntity({ disabledByUser: true });
    agentRepo.get.mockReturnValue(okAsync(entity));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto.disabledByUser).toBe(true);
    expect(agentRepo.save).toHaveBeenCalledWith(entity);
  });
});

describe("DisableAgentUseCase — error channel", () => {
  it("propagates AgentNotFound from repo.get and does not save", async () => {
    agentRepo.get.mockReturnValue(errAsync({ type: "AgentNotFound", fqn: AGENT_ID }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
    expect(agentRepo.save).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from repo.save", async () => {
    agentRepo.get.mockReturnValue(okAsync(agentEntity()));
    const cause = new Error("disk");
    agentRepo.save.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
