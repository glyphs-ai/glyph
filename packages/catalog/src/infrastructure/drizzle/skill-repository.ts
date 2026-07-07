/**
 * Drizzle-backed SkillRepository — the write-side port's adapter (get/save/
 * delete). Read projections live on `CatalogQueries`; this adapter only loads
 * the full aggregate for mutation and persists it.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. The private `find` loads the entity row + dep edges;
 * `get` turns absence into `SkillNotFound`.
 *
 * `save(skill, files?)` always rewrites the entity row + dep rows; when `files`
 * is given (install) it additionally rewrites `skill_files`, all in one
 * transaction. State-only mutations (ack prereqs) omit `files`.
 */

import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillFqn } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { Db } from "./catalog-db.js";
import { SkillMapper } from "./skill-mapper.js";
import { skillFiles, skillMcpDeps, skillSkillDeps, skills } from "./skill-schema.js";

export class DrizzleSkillRepository implements SkillRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(fqn: SkillFqn): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> {
    return this.find(eq(skills.fqn, fqn)).andThen(
      (skill): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> =>
        skill === undefined ? errAsync({ type: "SkillNotFound", fqn }) : okAsync(skill),
    );
  }

  /** Load the full aggregate (entity row + dep edges) for mutation. */
  private find(
    where: ReturnType<typeof eq>,
  ): ResultAsync<SkillEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = await this.db.select().from(skills).where(where).get();
        if (row === undefined) return undefined;
        const sDeps = await this.db
          .select()
          .from(skillSkillDeps)
          .where(eq(skillSkillDeps.sourceFqn, row.fqn))
          .all();
        const mDeps = await this.db
          .select()
          .from(skillMcpDeps)
          .where(eq(skillMcpDeps.sourceFqn, row.fqn))
          .all();
        return SkillMapper.toDomain(row, sDeps, mDeps);
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  save(
    skill: SkillEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = SkillMapper.toRow(skill);
        const skillDeps = SkillMapper.toSkillDepRows(skill);
        const mcpDeps = SkillMapper.toMcpDepRows(skill);
        const fileRows = files === undefined ? null : SkillMapper.toFileRows(skill, files);
        await this.db
          .insert(skills)
          .values(row)
          .onConflictDoUpdate({
            target: skills.fqn,
            set: {
              origin: row.origin,
              description: row.description,
              version: row.version,
              prereqs: row.prereqs,
              prereqsAck: row.prereqsAck,
              updatedAt: row.updatedAt,
            },
          })
          .run();
        await this.db.delete(skillSkillDeps).where(eq(skillSkillDeps.sourceFqn, skill.id)).run();
        if (skillDeps.length > 0) {
          await this.db.insert(skillSkillDeps).values(skillDeps).run();
        }
        await this.db.delete(skillMcpDeps).where(eq(skillMcpDeps.sourceFqn, skill.id)).run();
        if (mcpDeps.length > 0) {
          await this.db.insert(skillMcpDeps).values(mcpDeps).run();
        }
        if (fileRows !== null) {
          await this.db.delete(skillFiles).where(eq(skillFiles.skillFqn, skill.id)).run();
          if (fileRows.length > 0) {
            await this.db.insert(skillFiles).values(fileRows).run();
          }
        }
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  delete(fqn: SkillFqn): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        await this.db.delete(skillFiles).where(eq(skillFiles.skillFqn, fqn)).run();
        await this.db.delete(skillSkillDeps).where(eq(skillSkillDeps.sourceFqn, fqn)).run();
        await this.db.delete(skillMcpDeps).where(eq(skillMcpDeps.sourceFqn, fqn)).run();
        await this.db.delete(skills).where(eq(skills.fqn, fqn)).run();
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }
}
