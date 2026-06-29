import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListAgentsUseCase } from "../../../src/application/agent/list-agents.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const asAgentFqn = (value: string) => AgentFqnSchema.parse(value);
const asSkillFqn = (value: string) => SkillFqnSchema.parse(value);
const asMcpFqn = (value: string) => McpFqnSchema.parse(value);

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
let useCase: ListAgentsUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  useCase = new ListAgentsUseCase({ agentRepo });
});

describe("ListAgentsUseCase — read paths", () => {
  it("returns an empty array when no agents are installed", async () => {
    agentRepo.list.mockReturnValue(okAsync([]));

    const dto = (await useCase.execute({}))._unsafeUnwrap();

    expect(dto).toEqual([]);
  });

  it("projects installed agents to the list DTO", async () => {
    agentRepo.list.mockReturnValue(
      okAsync([
        agentEntity({
          disabledByUser: true,
          dependencyRefs: {
            skills: [asSkillFqn("public/tool-use")],
            mcps: [asMcpFqn("azure/mcp")],
            agents: [asAgentFqn("public/worker")],
          },
        }),
      ]),
    );

    const dto = (await useCase.execute({}))._unsafeUnwrap();

    expect(dto).toEqual([
      {
        id: "public/triage",
        disabledByUser: true,
        skills: ["public/tool-use"],
        mcps: ["azure/mcp"],
        agents: ["public/worker"],
      },
    ]);
  });
});

describe("ListAgentsUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.list", async () => {
    const cause = new Error("disk");
    agentRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({});

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
