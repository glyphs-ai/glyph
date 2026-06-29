import { describe, expect, it } from "vitest";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { McpMapper, type McpRow } from "../../../src/infrastructure/drizzle/mcp-mapper.js";

const ROW: McpRow = {
  fqn: "azure/mcp",
  origin: "file:/c/mcps/azure.json",
  spec: '{"_meta":{"name":"azure/mcp"},"command":"npx"}',
  installedAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

describe("McpMapper", () => {
  it("toDomain rehydrates an entity carrying every column", () => {
    const e = McpMapper.toDomain(ROW);
    expect(e).toBeInstanceOf(McpEntity);
    expect(e.fqn).toBe("azure/mcp");
    expect(e.origin).toBe(ROW.origin);
    expect(e.spec).toBe(ROW.spec);
    expect(e.installedAt).toBe(ROW.installedAt);
    expect(e.updatedAt).toBe(ROW.updatedAt);
  });

  it("toRow round-trips with toDomain", () => {
    const e = new McpEntity({
      fqn: "azure/mcp" as McpFqn,
      origin: ROW.origin,
      spec: ROW.spec,
      installedAt: ROW.installedAt,
      updatedAt: ROW.updatedAt,
    });
    expect(McpMapper.toRow(e)).toEqual(ROW);
  });
});
