/**
 * Read helpers over the MCP tables, invoked inside a `CatalogQueries.query`
 * lambda (so a driver fault is captured centrally as `DatabaseUnavailable`).
 *
 *   - `collectReferencedMcpFqns`: the set of MCP fqns some installed agent or
 *     skill declares a dependency on (reads only the two mcp-dep edge tables'
 *     `target_fqn`); an MCP absent from it is orphaned.
 *   - `selectInstalledMcpFqns`: the set of installed MCP fqns, for cheap
 *     "is this dependency installed?" checks during status computation.
 */

import { eq } from "drizzle-orm";
import { agentMcpDeps } from "../../infrastructure/drizzle/agent-schema.js";
import type { Db } from "../../infrastructure/drizzle/catalog-db.js";
import { mcps } from "../../infrastructure/drizzle/mcp-schema.js";
import { skillMcpDeps } from "../../infrastructure/drizzle/skill-schema.js";

export type McpRow = typeof mcps.$inferSelect;

/** One MCP row by fqn, or `undefined` when absent. */
export function selectMcpByFqn(db: Db, fqn: string): McpRow | undefined {
  return db.select().from(mcps).where(eq(mcps.fqn, fqn)).get();
}

/** One MCP row by origin, or `undefined` when absent. */
export function selectMcpByOrigin(db: Db, origin: string): McpRow | undefined {
  return db.select().from(mcps).where(eq(mcps.origin, origin)).get();
}

export function collectReferencedMcpFqns(db: Db): Set<string> {
  const referenced = new Set<string>();
  for (const dep of db.select({ target: agentMcpDeps.targetFqn }).from(agentMcpDeps).all()) {
    referenced.add(dep.target);
  }
  for (const dep of db.select({ target: skillMcpDeps.targetFqn }).from(skillMcpDeps).all()) {
    referenced.add(dep.target);
  }
  return referenced;
}

export function selectInstalledMcpFqns(db: Db): Set<string> {
  return new Set(
    db
      .select({ fqn: mcps.fqn })
      .from(mcps)
      .all()
      .map((row) => row.fqn),
  );
}
