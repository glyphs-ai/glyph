import { describe, expect, it } from "vitest";
import { McpEntity } from "../../src/domain/mcp-entity.js";
import { McpFqnSchema } from "../../src/domain/mcp-fqn.js";

function makeMcp(): McpEntity {
  return McpEntity.create({
    fqn: McpFqnSchema.parse("azure/mcp"),
    origin: "file:/tmp/azure-mcp.json",
    spec: '{"command":"npx","args":["-y","azure-mcp"]}',
    now: "2026-01-01T00:00:00.000Z",
  });
}

describe("McpEntity.create", () => {
  it("preserves the spec bytes verbatim", () => {
    expect(makeMcp().spec).toBe('{"command":"npx","args":["-y","azure-mcp"]}');
  });

  it("seeds installedAt and updatedAt from `now`", () => {
    const m = makeMcp();
    expect(m.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(m.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("exposes id as the fqn", () => {
    expect(makeMcp().id).toBe("azure/mcp");
  });

  it("records origin as provenance distinct from identity", () => {
    expect(makeMcp().origin).toBe("file:/tmp/azure-mcp.json");
  });
});
