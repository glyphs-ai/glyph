/**
 * Read-path tests for `ListMcpsUseCase`. Integration-style: a real in-memory
 * catalog db is seeded via the write repositories, then the use-case runs its
 * `CatalogQueries` SELECT. Rows come back ordered by fqn, each tagged with a
 * derived `orphaned` flag.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListMcpsUseCase } from "../../../src/application/mcp/list-mcps.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

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

let db: Db;
let close: () => void;
let mcpRepo: DrizzleMcpRepository;
let agentRepo: DrizzleAgentRepository;
let skillRepo: DrizzleSkillRepository;
let useCase: ListMcpsUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  mcpRepo = new DrizzleMcpRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new ListMcpsUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("ListMcpsUseCase — read paths", () => {
  it("returns [] when no MCPs are installed", async () => {
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual([]);
  });

  it("lists MCP DTOs and marks orphaned status from agent and skill references", async () => {
    (await mcpRepo.save(mcp(AZURE_ID, "file://catalog/azure.json")))._unsafeUnwrap();
    (await mcpRepo.save(mcp(GITHUB_ID, "file://catalog/github.json")))._unsafeUnwrap();
    (await agentRepo.save(agentUsing([AZURE_ID])))._unsafeUnwrap();
    (await skillRepo.save(skillUsing([])))._unsafeUnwrap();

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
