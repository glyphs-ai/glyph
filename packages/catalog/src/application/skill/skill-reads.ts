/**
 * Read helpers over the skill tables, invoked inside a `CatalogQueries.query`
 * lambda (so a driver fault is captured centrally as `DatabaseUnavailable`).
 *
 * `SkillView` mirrors the persisted skill data — a plain row-shaped read model
 * (0/1 flags normalised to booleans, `prereqs` null normalised to `undefined`)
 * plus `dependencyRefs` assembled from the dep-edge tables. It is NOT the
 * `SkillEntity` aggregate: reads trust the persisted row and carry no
 * behaviour or invariants. Its fields intentionally match the entity's public
 * data shape so projection / status code reads either interchangeably.
 */

import { eq } from "drizzle-orm";
import type { SkillDependencyRefs } from "../../domain/skill-deps.js";
import { agentSkillDeps } from "../../infrastructure/drizzle/agent-schema.js";
import type { Db } from "../../infrastructure/drizzle/catalog-db.js";
import { skillMcpDeps, skillSkillDeps, skills } from "../../infrastructure/drizzle/skill-schema.js";

export interface SkillView {
  readonly fqn: string;
  readonly origin: string;
  readonly description: string;
  readonly version: string;
  readonly prereqs: string | undefined;
  readonly prereqsAck: boolean;
  readonly dependencyRefs: SkillDependencyRefs;
  readonly installedAt: string;
  readonly updatedAt: string;
}

type SkillRow = typeof skills.$inferSelect;

function toSkillView(row: SkillRow, dependencyRefs: SkillDependencyRefs): SkillView {
  return {
    fqn: row.fqn,
    origin: row.origin,
    description: row.description,
    version: row.version,
    prereqs: row.prereqs ?? undefined,
    prereqsAck: row.prereqsAck === 1,
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

async function assembleSkill(db: Db, row: SkillRow): Promise<SkillView> {
  const skillDeps = await db
    .select({ target: skillSkillDeps.targetFqn })
    .from(skillSkillDeps)
    .where(eq(skillSkillDeps.sourceFqn, row.fqn))
    .all();
  const mcpDeps = await db
    .select({ target: skillMcpDeps.targetFqn })
    .from(skillMcpDeps)
    .where(eq(skillMcpDeps.sourceFqn, row.fqn))
    .all();
  return toSkillView(row, {
    skills: skillDeps.map((d) => d.target),
    mcps: mcpDeps.map((d) => d.target),
  });
}

/** One skill (row + assembled deps) by fqn, or `undefined` when absent. */
export async function selectSkillByFqn(db: Db, fqn: string): Promise<SkillView | undefined> {
  const row = await db.select().from(skills).where(eq(skills.fqn, fqn)).get();
  return row === undefined ? undefined : await assembleSkill(db, row);
}

/** One skill (row + assembled deps) by origin, or `undefined` when absent. */
export async function selectSkillByOrigin(db: Db, origin: string): Promise<SkillView | undefined> {
  const row = await db.select().from(skills).where(eq(skills.origin, origin)).get();
  return row === undefined ? undefined : await assembleSkill(db, row);
}

/** Every installed skill (row + assembled deps), ordered by fqn. */
export async function selectAllSkills(db: Db): Promise<SkillView[]> {
  const rows = await db.select().from(skills).orderBy(skills.fqn).all();
  const skillDeps = bucketBySource(
    await db
      .select({ source: skillSkillDeps.sourceFqn, target: skillSkillDeps.targetFqn })
      .from(skillSkillDeps)
      .all(),
  );
  const mcpDeps = bucketBySource(
    await db
      .select({ source: skillMcpDeps.sourceFqn, target: skillMcpDeps.targetFqn })
      .from(skillMcpDeps)
      .all(),
  );
  return rows.map((row) =>
    toSkillView(row, { skills: skillDeps.get(row.fqn) ?? [], mcps: mcpDeps.get(row.fqn) ?? [] }),
  );
}

/**
 * The set of skill fqns some installed agent or skill declares a dependency on
 * (reads only the two skill-dep edge tables' `target_fqn`); a skill absent from
 * it is orphaned.
 */
export async function collectReferencedSkillFqns(db: Db): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const dep of await db
    .select({ target: agentSkillDeps.targetFqn })
    .from(agentSkillDeps)
    .all()) {
    referenced.add(dep.target);
  }
  for (const dep of await db
    .select({ target: skillSkillDeps.targetFqn })
    .from(skillSkillDeps)
    .all()) {
    referenced.add(dep.target);
  }
  return referenced;
}
