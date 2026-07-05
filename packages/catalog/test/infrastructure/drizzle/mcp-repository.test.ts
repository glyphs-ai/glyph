import { beforeEach, describe, expect, it } from "vitest";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";

/**
 * Uses in-memory SQLite with migrations applied by `openDb`. Repository
 * reads and writes exercise persisted MCP metadata and JSON specs.
 */
let repo: DrizzleMcpRepository;

beforeEach(() => {
  repo = new DrizzleMcpRepository({ db: openDb(":memory:").db });
});

const NOW = "2025-01-01T00:00:00.000Z";

function mcp(name = "mcp", ns = "azure"): McpEntity {
  return new McpEntity({
    fqn: `${ns}/${name}` as McpFqn,
    origin: `file:/c/mcps/${name}.json`,
    spec: `{"_meta":{"name":"${ns}/${name}"}}`,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

describe("DrizzleMcpRepository", () => {
  it("save + get round-trip keeps the spec verbatim", async () => {
    const m = mcp();
    expect((await repo.save(m)).isOk()).toBe(true);
    const got = (await repo.get(m.id))._unsafeUnwrap();
    expect(got.fqn).toBe("azure/mcp");
    expect(got.spec).toBe(m.spec);
  });

  it("get returns McpNotFound for an unknown fqn", async () => {
    expect((await repo.get("azure/missing" as McpFqn))._unsafeUnwrapErr().type).toBe("McpNotFound");
  });

  it("save replaces an existing row (insert-or-replace)", async () => {
    await repo.save(mcp());
    await repo.save(
      new McpEntity({
        fqn: "azure/mcp" as McpFqn,
        origin: "file:/c/mcps/mcp.json",
        spec: '{"_meta":{"name":"azure/mcp"},"v":2}',
        installedAt: NOW,
        updatedAt: "2025-02-01T00:00:00.000Z",
      }),
    );
    expect((await repo.get("azure/mcp" as McpFqn))._unsafeUnwrap().spec).toContain('"v":2');
  });

  it("delete removes the row", async () => {
    const m = mcp();
    await repo.save(m);
    await repo.delete(m.id);
    expect((await repo.get(m.id))._unsafeUnwrapErr().type).toBe("McpNotFound");
  });
});
