import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListMcpsUseCase } from "../../../src/application/mcp/list-mcps.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const AZURE_ID = "azure/mcp" as McpFqn;
const GITHUB_ID = "github/mcp" as McpFqn;
const INSTALLED_AT = "2025-01-01T00:00:00.000Z";
const UPDATED_AT = "2025-01-02T00:00:00.000Z";

function mcp(fqn: McpFqn, origin: string): McpEntity {
  return new McpEntity({
    fqn,
    origin,
    spec: `{"_meta":{"name":"${fqn}"}}`,
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

function agentUsing(mcps: readonly string[]): AgentEntity {
  return new AgentEntity({
    fqn: "public/triage" as AgentFqn,
    origin: "file://catalog/triage/AGENTS.md",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps, agents: [] },
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

function skillUsing(mcps: readonly string[]): SkillEntity {
  return new SkillEntity({
    fqn: "public/tool-use" as SkillFqn,
    origin: "file://catalog/tool-use/SKILL.md",
    description: "Tool use skill",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: [], mcps },
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

let mcpRepo: MockProxy<McpRepository>;
let agentRepo: MockProxy<AgentRepository>;
let skillRepo: MockProxy<SkillRepository>;
let useCase: ListMcpsUseCase;

beforeEach(() => {
  mcpRepo = mock<McpRepository>();
  agentRepo = mock<AgentRepository>();
  skillRepo = mock<SkillRepository>();
  mcpRepo.list.mockReturnValue(okAsync([]));
  agentRepo.list.mockReturnValue(okAsync([]));
  skillRepo.list.mockReturnValue(okAsync([]));
  useCase = new ListMcpsUseCase({ mcpRepo, agentRepo, skillRepo });
});

describe("ListMcpsUseCase — read paths", () => {
  it("lists MCP DTOs and marks orphaned status from agent and skill references", async () => {
    mcpRepo.list.mockReturnValue(
      okAsync([
        mcp(AZURE_ID, "file://catalog/azure.json"),
        mcp(GITHUB_ID, "file://catalog/github.json"),
      ]),
    );
    agentRepo.list.mockReturnValue(okAsync([agentUsing([AZURE_ID])]));
    skillRepo.list.mockReturnValue(okAsync([skillUsing([])]));

    const dto = (await useCase.execute({}))._unsafeUnwrap();
    expect(dto).toEqual([
      {
        fqn: AZURE_ID,
        origin: "file://catalog/azure.json",
        orphaned: false,
        installedAt: INSTALLED_AT,
        updatedAt: UPDATED_AT,
      },
      {
        fqn: GITHUB_ID,
        origin: "file://catalog/github.json",
        orphaned: true,
        installedAt: INSTALLED_AT,
        updatedAt: UPDATED_AT,
      },
    ]);
  });
});

describe("ListMcpsUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from mcpRepo.list", async () => {
    mcpRepo.list.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({});
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(agentRepo.list).not.toHaveBeenCalled();
    expect(skillRepo.list).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from agentRepo.list", async () => {
    agentRepo.list.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({});
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(skillRepo.list).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from skillRepo.list", async () => {
    skillRepo.list.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({});
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
