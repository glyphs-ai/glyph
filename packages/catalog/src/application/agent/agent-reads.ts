/**
 * Read helpers over the agent tables, invoked inside a `CatalogQueries.query`
 * lambda (so a driver fault is captured centrally as `DatabaseUnavailable`).
 *
 * `AgentView` mirrors the persisted agent data — a plain row-shaped read model
 * (0/1 flags normalised to booleans, `prereqs` null normalised to `undefined`)
 * plus `dependencyRefs` assembled from the three dep-edge tables. It is NOT the
 * `AgentEntity` aggregate: reads trust the persisted row and carry no behaviour
 * or invariants. Its fields intentionally match the entity's public data shape
 * so projection / status code reads either interchangeably.
 */

import { eq } from "drizzle-orm";
import type { AgentDependencyRefs } from "../../domain/agent-deps.js";
import {
  agentAgentDeps,
  agentMcpDeps,
  agentSkillDeps,
  agents,
} from "../../infrastructure/drizzle/agent-schema.js";
import type { Db } from "../../infrastructure/drizzle/catalog-db.js";

export interface AgentView {
  readonly fqn: string;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly prereqsAck: boolean;
  readonly disabledByUser: boolean;
  readonly dependencyRefs: AgentDependencyRefs;
  readonly installedAt: string;
  readonly updatedAt: string;
}

type AgentRow = typeof agents.$inferSelect;

function toAgentView(row: AgentRow, dependencyRefs: AgentDependencyRefs): AgentView {
  return {
    fqn: row.fqn,
    origin: row.origin,
    description: row.description,
    version: row.version,
    prereqs: row.prereqs ?? undefined,
    prereqsAck: row.prereqsAck === 1,
    disabledByUser: row.disabledByUser === 1,
    dependencyRefs,
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
  };
}

function bucketBySource(
  rows: readonly { source: string; target: string }[],
): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const { source, target } of rows) {
    const arr = buckets.get(source) ?? [];
    arr.push(target);
    buckets.set(source, arr);
  }
  return buckets;
}

async function assembleAgent(db: Db, row: AgentRow): Promise<AgentView> {
  const skillDeps = await db
    .select({ target: agentSkillDeps.targetFqn })
    .from(agentSkillDeps)
    .where(eq(agentSkillDeps.sourceFqn, row.fqn))
    .all();
  const mcpDeps = await db
    .select({ target: agentMcpDeps.targetFqn })
    .from(agentMcpDeps)
    .where(eq(agentMcpDeps.sourceFqn, row.fqn))
    .all();
  const agentDeps = await db
    .select({ target: agentAgentDeps.targetFqn })
    .from(agentAgentDeps)
    .where(eq(agentAgentDeps.sourceFqn, row.fqn))
    .all();
  return toAgentView(row, {
    skills: skillDeps.map((d) => d.target),
    mcps: mcpDeps.map((d) => d.target),
    agents: agentDeps.map((d) => d.target),
  });
}

/** One agent (row + assembled deps) by fqn, or `undefined` when absent. */
export async function selectAgentByFqn(db: Db, fqn: string): Promise<AgentView | undefined> {
  const row = await db.select().from(agents).where(eq(agents.fqn, fqn)).get();
  return row === undefined ? undefined : await assembleAgent(db, row);
}

/** One agent (row + assembled deps) by origin, or `undefined` when absent. */
export async function selectAgentByOrigin(db: Db, origin: string): Promise<AgentView | undefined> {
  const row = await db.select().from(agents).where(eq(agents.origin, origin)).get();
  return row === undefined ? undefined : await assembleAgent(db, row);
}

/** Every installed agent (row + assembled deps), ordered by fqn. */
export async function selectAllAgents(db: Db): Promise<AgentView[]> {
  const rows = await db.select().from(agents).orderBy(agents.fqn).all();
  const skillDeps = bucketBySource(
    await db
      .select({ source: agentSkillDeps.sourceFqn, target: agentSkillDeps.targetFqn })
      .from(agentSkillDeps)
      .all(),
  );
  const mcpDeps = bucketBySource(
    await db
      .select({ source: agentMcpDeps.sourceFqn, target: agentMcpDeps.targetFqn })
      .from(agentMcpDeps)
      .all(),
  );
  const agentDeps = bucketBySource(
    await db
      .select({ source: agentAgentDeps.sourceFqn, target: agentAgentDeps.targetFqn })
      .from(agentAgentDeps)
      .all(),
  );
  return rows.map((row) =>
    toAgentView(row, {
      skills: skillDeps.get(row.fqn) ?? [],
      mcps: mcpDeps.get(row.fqn) ?? [],
      agents: agentDeps.get(row.fqn) ?? [],
    }),
  );
}

/**
 * The set of agent fqns some installed agent declares a coordinator dependency
 * on (reads only the agent-agent edge table's `target_fqn`). Used to guard
 * uninstall: an agent still referenced here has dependents.
 */
export async function collectReferencedAgentFqns(db: Db): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const dep of await db
    .select({ target: agentAgentDeps.targetFqn })
    .from(agentAgentDeps)
    .all()) {
    referenced.add(dep.target);
  }
  return referenced;
}
