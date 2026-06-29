/**
 * Drizzle-backed SkillRepository — the port's adapter.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. Each method wraps its (synchronous better-sqlite3)
 * work in an inline async IIFE so a sync throw surfaces as a promise
 * rejection that `ResultAsync.fromPromise` routes into the `Err` channel
 * A shared `find` primitive returns the entity or `undefined`; `get`,
 * `getByOrigin`, and `getAnchor` turn absence into `SkillNotFound`.
 *
 * `save(skill, files?)` always rewrites the entity row + dep rows; when
 * `files` is given (install) it additionally rewrites `skill_files`, all
 * in one transaction. State-only mutations (ack prereqs) omit `files`,
 * leaving the tree untouched.
 */

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type {
  CatalogFile,
  CatalogFileEntry,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillFqn } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import { type SkillDepRow, SkillMapper } from "./skill-mapper.js";
import { skillFiles, skillMcpDeps, skillSkillDeps, skills } from "./skill-schema.js";

type Db = BetterSQLite3Database<{
  skills: typeof skills;
  skillFiles: typeof skillFiles;
  skillSkillDeps: typeof skillSkillDeps;
  skillMcpDeps: typeof skillMcpDeps;
}>;

const ANCHOR = "SKILL.md";

export class DrizzleSkillRepository implements SkillRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(fqn: SkillFqn): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> {
    return this.assertFound(this.findByFqn(fqn), fqn);
  }

  getByOrigin(origin: string): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> {
    return this.assertFound(this.findByOrigin(origin), origin);
  }

  findByFqn(fqn: SkillFqn): ResultAsync<SkillEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(skills.fqn, fqn));
  }

  findByOrigin(origin: string): ResultAsync<SkillEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(skills.origin, origin));
  }

  /** Turn a `find` miss into the business `SkillNotFound` (keyed by `key`). */
  private assertFound(
    found: ResultAsync<SkillEntity | undefined, DatabaseUnavailable>,
    key: string,
  ): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> {
    return found.andThen(
      (skill): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable> =>
        skill === undefined ? errAsync({ type: "SkillNotFound", fqn: key }) : okAsync(skill),
    );
  }

  /** Shared query primitive: the matching aggregate, or `undefined`. */
  private find(
    where: ReturnType<typeof eq>,
  ): ResultAsync<SkillEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db.select().from(skills).where(where).get();
        if (row === undefined) return undefined;
        const sDeps = this.db
          .select()
          .from(skillSkillDeps)
          .where(eq(skillSkillDeps.sourceFqn, row.fqn))
          .all();
        const mDeps = this.db
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
        this.db.transaction((tx) => {
          tx.insert(skills)
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
          tx.delete(skillSkillDeps).where(eq(skillSkillDeps.sourceFqn, skill.id)).run();
          if (skillDeps.length > 0) tx.insert(skillSkillDeps).values(skillDeps).run();
          tx.delete(skillMcpDeps).where(eq(skillMcpDeps.sourceFqn, skill.id)).run();
          if (mcpDeps.length > 0) tx.insert(skillMcpDeps).values(mcpDeps).run();
          if (fileRows !== null) {
            tx.delete(skillFiles).where(eq(skillFiles.skillFqn, skill.id)).run();
            if (fileRows.length > 0) tx.insert(skillFiles).values(fileRows).run();
          }
        });
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  delete(fqn: SkillFqn): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.transaction((tx) => {
          tx.delete(skillFiles).where(eq(skillFiles.skillFqn, fqn)).run();
          tx.delete(skillSkillDeps).where(eq(skillSkillDeps.sourceFqn, fqn)).run();
          tx.delete(skillMcpDeps).where(eq(skillMcpDeps.sourceFqn, fqn)).run();
          tx.delete(skills).where(eq(skills.fqn, fqn)).run();
        });
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  list(): ResultAsync<SkillEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const rows = this.db.select().from(skills).orderBy(skills.fqn).all();
        const bucket = (deps: SkillDepRow[]): Map<string, SkillDepRow[]> => {
          const m = new Map<string, SkillDepRow[]>();
          for (const d of deps) {
            const arr = m.get(d.sourceFqn) ?? [];
            arr.push(d);
            m.set(d.sourceFqn, arr);
          }
          return m;
        };
        const sBySkill = bucket(this.db.select().from(skillSkillDeps).all());
        const mBySkill = bucket(this.db.select().from(skillMcpDeps).all());
        return rows.map((r) =>
          SkillMapper.toDomain(r, sBySkill.get(r.fqn) ?? [], mBySkill.get(r.fqn) ?? []),
        );
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  getAnchor(fqn: SkillFqn): ResultAsync<string, SkillNotFound | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const anchor = this.db
          .select({ content: skillFiles.content })
          .from(skillFiles)
          .where(and(eq(skillFiles.skillFqn, fqn), eq(skillFiles.relPath, ANCHOR)))
          .get();
        return anchor?.content.toString("utf8");
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    ).andThen(
      (content): ResultAsync<string, SkillNotFound | DatabaseUnavailable> =>
        content === undefined ? errAsync({ type: "SkillNotFound", fqn }) : okAsync(content),
    );
  }

  listFilePaths(fqn: SkillFqn): ResultAsync<CatalogFileEntry[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const rows = this.db
          .select({ relPath: skillFiles.relPath, content: skillFiles.content })
          .from(skillFiles)
          .where(eq(skillFiles.skillFqn, fqn))
          .orderBy(skillFiles.relPath)
          .all();
        return rows.map((row) => ({ relPath: row.relPath, size: row.content.byteLength }));
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  getFile(fqn: SkillFqn, relPath: string): ResultAsync<Buffer | null, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db
          .select({ content: skillFiles.content })
          .from(skillFiles)
          .where(and(eq(skillFiles.skillFqn, fqn), eq(skillFiles.relPath, relPath)))
          .get();
        return row?.content ?? null;
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }

  async *streamFiles(fqn: SkillFqn): AsyncIterable<CatalogFile> {
    const rows = this.db
      .select({ relPath: skillFiles.relPath, content: skillFiles.content })
      .from(skillFiles)
      .where(eq(skillFiles.skillFqn, fqn))
      .orderBy(skillFiles.relPath)
      .all();
    for (const row of rows) yield row;
  }

  existsUsingSkill(skill: SkillFqn): ResultAsync<boolean, DatabaseUnavailable> {
    return this.existsWithTarget(skillSkillDeps, skill);
  }

  existsUsingMcp(mcp: McpFqn): ResultAsync<boolean, DatabaseUnavailable> {
    return this.existsWithTarget(skillMcpDeps, mcp);
  }

  /**
   * Indexed existence probe: is there any dep row in `table` whose
   * `target_fqn` equals `target`? `limit(1)` short-circuits at the first
   * match (the `*_tgt_idx` index covers it).
   */
  private existsWithTarget(
    table: typeof skillSkillDeps | typeof skillMcpDeps,
    target: string,
  ): ResultAsync<boolean, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db
          .select({ source: table.sourceFqn })
          .from(table)
          .where(eq(table.targetFqn, target))
          .limit(1)
          .get();
        return row !== undefined;
      })(),
      DrizzleSkillRepository.asDatabaseUnavailable,
    );
  }
}
