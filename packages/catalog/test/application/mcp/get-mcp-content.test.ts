/**
 * Read-path tests for `GetMcpContentUseCase`. Integration-style: seed a real
 * in-memory catalog db via the write repository, then project the spec bytes
 * through the `CatalogQueries` read seam.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetMcpContentUseCase } from "../../../src/application/mcp/get-mcp-content.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { Db } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { openTestDb } from "../../testing.js";

const MCP_ID = "azure/mcp" as McpFqn;
const SPEC = '{"_meta":{"name":"azure/mcp"}}';

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: "file://catalog/azure.json",
    spec: SPEC,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let db: Db;
let close: () => void;
let mcpRepo: DrizzleMcpRepository;
let useCase: GetMcpContentUseCase;

beforeEach(async () => {
  const opened = await openTestDb(":memory:");
  db = opened.db;
  close = opened.close;
  mcpRepo = new DrizzleMcpRepository({ db });
  useCase = new GetMcpContentUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetMcpContentUseCase — read paths", () => {
  it("returns the MCP spec string", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, spec: SPEC });
  });

  it("propagates McpNotFound when the id does not resolve", async () => {
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: MCP_ID });
  });
});
