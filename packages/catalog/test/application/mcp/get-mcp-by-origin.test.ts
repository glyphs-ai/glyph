/**
 * Read-path tests for `GetMcpByOriginUseCase`. Integration-style: seed a real
 * in-memory catalog db via the write repository, then reverse-look-up by
 * origin through the `CatalogQueries` read seam.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetMcpByOriginUseCase } from "../../../src/application/mcp/get-mcp-by-origin.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";

const MCP_ID = "azure/mcp" as McpFqn;
const ORIGIN = "file://catalog/azure.json";
const SPEC = '{"_meta":{"name":"azure/mcp"}}';

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: ORIGIN,
    spec: SPEC,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let db: Db;
let close: () => void;
let mcpRepo: DrizzleMcpRepository;
let useCase: GetMcpByOriginUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  mcpRepo = new DrizzleMcpRepository({ db });
  useCase = new GetMcpByOriginUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetMcpByOriginUseCase — read paths", () => {
  it("returns the projected MCP content DTO for the origin", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    const dto = (await useCase.execute({ origin: ORIGIN }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, origin: ORIGIN, spec: SPEC });
  });

  it("propagates McpNotFound when no MCP has that origin", async () => {
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: ORIGIN });
  });
});
