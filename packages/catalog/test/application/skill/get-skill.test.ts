import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSkillUseCase } from "../../../src/application/skill/get-skill.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const MCP_ID = McpFqnSchema.parse("azure/mcp");
const AGENT_ID = AgentFqnSchema.parse("public/triage");
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

function skill(overrides: Partial<SkillEntityArgs> = {}): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: "file:///skills/tool-use",
    description: "Tool use",
    version: "1.0.0",
    prereqs: "set GITHUB_TOKEN",
    prereqsAck: false,
    dependencyRefs: { skills: [], mcps: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function agentWithSkill(skillFqn = SKILL_ID): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: "file:///agents/triage",
    description: "Triage",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [skillFqn], mcps: [], agents: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

function skillDto(entity: SkillEntity, orphaned: boolean) {
  const dependencies =
    entity.dependencyRefs.skills.length > 0 || entity.dependencyRefs.mcps.length > 0
      ? {
          ...(entity.dependencyRefs.skills.length > 0
            ? { skills: entity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.mcps.length > 0
            ? { mcps: entity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
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
    orphaned,
    installedAt: entity.installedAt,
    updatedAt: entity.updatedAt,
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let useCase: GetSkillUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  agentRepo.list.mockReturnValue(okAsync([]));
  skillRepo.list.mockReturnValue(okAsync([]));
  useCase = new GetSkillUseCase({ skillRepo, agentRepo });
});

describe("GetSkillUseCase — read paths", () => {
  it("propagates SkillNotFound when the skill is not installed", async () => {
    skillRepo.get.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: SKILL_ID }));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
    expect(agentRepo.list).not.toHaveBeenCalled();
  });

  it("returns the projected Skill DTO with dependencies and orphaned=false", async () => {
    const entity = skill({ dependencyRefs: { skills: ["public/child"], mcps: [MCP_ID] } });
    skillRepo.get.mockReturnValue(okAsync(entity));
    agentRepo.list.mockReturnValue(okAsync([agentWithSkill()]));
    skillRepo.list.mockReturnValue(okAsync([entity]));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual(skillDto(entity, false));
  });
});

describe("GetSkillUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.get", async () => {
    skillRepo.get.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from agentRepo.list", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill()));
    agentRepo.list.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from skillRepo.list", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill()));
    skillRepo.list.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
