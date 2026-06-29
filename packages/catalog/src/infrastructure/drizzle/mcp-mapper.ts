/**
 * Row ↔ MCP mapper. The repository delegates every shape translation here
 * so the repository reads like pure persistence orchestration (queries +
 * transactions) without inline `new McpEntity(...)`. The mapper is
 * drizzle-only and has no manifest knowledge.
 *
 * Row types are derived via Drizzle's `$inferSelect`, so the schema is the
 * single source of truth and TS can never drift from the column defs.
 * `toDomain` casts `row.fqn` to `McpFqn` — the trusted-source door: a
 * persisted row was already shape-validated on the way in.
 */

import { McpEntity } from "../../domain/mcp-entity.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type { mcps } from "./mcp-schema.js";

export type McpRow = typeof mcps.$inferSelect;

export const McpMapper = {
  toDomain(row: McpRow): McpEntity {
    return new McpEntity({
      fqn: row.fqn as McpFqn,
      origin: row.origin,
      spec: row.spec,
      installedAt: row.installedAt,
      updatedAt: row.updatedAt,
    });
  },

  toRow(mcp: McpEntity): McpRow {
    return {
      fqn: mcp.id,
      origin: mcp.origin,
      spec: mcp.spec,
      installedAt: mcp.installedAt,
      updatedAt: mcp.updatedAt,
    };
  },
} as const;
