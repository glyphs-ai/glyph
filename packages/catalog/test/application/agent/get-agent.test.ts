import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetAgentUseCase } from "../../../src/application/agent/get-agent.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";

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

let db: Db;
let close: () => void;
let agentRepo: DrizzleAgentRepository;
let useCase: GetAgentUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new GetAgentUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetAgentUseCase — read paths", () => {
  it("propagates AgentNotFound when the agent is not installed", async () => {
    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
  });

  it("returns the projected Agent DTO with conditional prereqs and dependencies", async () => {
    const entity = agentEntity({
      prereqs: "Set token",
      prereqsAck: false,
      dependencyRefs: {
        skills: [asSkillFqn("public/tool-use")],
        mcps: [asMcpFqn("azure/mcp")],
        agents: [asAgentFqn("public/worker")],
      },
    });
    (await agentRepo.save(entity))._unsafeUnwrap();

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto).toEqual(agentDto(entity));
  });

  it("omits optional prereqs and dependencies when absent", async () => {
    const entity = agentEntity();
    (await agentRepo.save(entity))._unsafeUnwrap();

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto).toEqual(agentDto(entity));
    expect(dto).not.toHaveProperty("prereqs");
    expect(dto).not.toHaveProperty("dependencies");
  });
});
