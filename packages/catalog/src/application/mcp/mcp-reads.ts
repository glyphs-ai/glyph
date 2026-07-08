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
import { type McpRow, mcps } from "../../infrastructure/drizzle/mcp-schema.js";
import { skillMcpDeps } from "../../infrastructure/drizzle/skill-schema.js";

/** One MCP row by fqn, or `undefined` when absent. */
export async function selectMcpByFqn(db: Db, fqn: string): Promise<McpRow | undefined> {
  return await db.select().from(mcps).where(eq(mcps.fqn, fqn)).get();
}

/** One MCP row by origin, or `undefined` when absent. */
export async function selectMcpByOrigin(db: Db, origin: string): Promise<McpRow | undefined> {
  return await db.select().from(mcps).where(eq(mcps.origin, origin)).get();
}

export async function collectReferencedMcpFqns(db: Db): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const dep of await db.select({ target: agentMcpDeps.targetFqn }).from(agentMcpDeps).all()) {
    referenced.add(dep.target);
  }
  for (const dep of await db.select({ target: skillMcpDeps.targetFqn }).from(skillMcpDeps).all()) {
    referenced.add(dep.target);
  }
  return referenced;
}

export async function selectInstalledMcpFqns(db: Db): Promise<Set<string>> {
  const rows = await db.select({ fqn: mcps.fqn }).from(mcps).all();
  return new Set(rows.map((row) => row.fqn));
}
