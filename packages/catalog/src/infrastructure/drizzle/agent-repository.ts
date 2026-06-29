/**
 * Drizzle-backed AgentRepository — the port's adapter.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. Each method wraps its (synchronous better-sqlite3)
 * work in an inline async IIFE so a sync throw surfaces as a promise
 * rejection that `ResultAsync.fromPromise` routes into the `Err` channel
 * A shared `find` primitive returns the entity or `undefined`; `get` and
 * `getAnchor` turn absence into `AgentNotFound`.
 *
 * `save(agent, files?)` always rewrites the entity row + dep rows; when
 * `files` is given (install) it additionally rewrites `agent_files`, all
 * in one transaction. State-only mutations (enable/disable) omit `files`,
 * leaving the tree untouched.
 */

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { AgentEntity } from "../../domain/agent-entity.js";
import type { AgentFqn } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  CatalogFile,
  CatalogFileEntry,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type { SkillFqn } from "../../domain/skill-fqn.js";
import { type AgentDepRow, AgentMapper } from "./agent-mapper.js";
import {
  agentAgentDeps,
  agentFiles,
  agentMcpDeps,
  agentSkillDeps,
  agents,
} from "./agent-schema.js";

type Db = BetterSQLite3Database<{
  agents: typeof agents;
  agentFiles: typeof agentFiles;
  agentSkillDeps: typeof agentSkillDeps;
  agentMcpDeps: typeof agentMcpDeps;
  agentAgentDeps: typeof agentAgentDeps;
}>;

export class DrizzleAgentRepository implements AgentRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: AgentFqn): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable> {
    return this.findByFqn(id).andThen(
      (agent): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable> =>
        agent === undefined ? errAsync({ type: "AgentNotFound", fqn: id }) : okAsync(agent),
    );
  }

  findByFqn(fqn: AgentFqn): ResultAsync<AgentEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(agents.fqn, fqn));
  }

  findByOrigin(origin: string): ResultAsync<AgentEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(agents.origin, origin));
  }

  /** Shared query primitive: the matching aggregate, or `undefined`. */
  private find(
    where: ReturnType<typeof eq>,
  ): ResultAsync<AgentEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db.select().from(agents).where(where).get();
        if (row === undefined) return undefined;
        const sDeps = this.db
          .select()
          .from(agentSkillDeps)
          .where(eq(agentSkillDeps.sourceFqn, row.fqn))
          .all();
        const mDeps = this.db
          .select()
          .from(agentMcpDeps)
          .where(eq(agentMcpDeps.sourceFqn, row.fqn))
          .all();
        const aDeps = this.db
          .select()
          .from(agentAgentDeps)
          .where(eq(agentAgentDeps.sourceFqn, row.fqn))
          .all();
        return AgentMapper.toDomain(row, sDeps, mDeps, aDeps);
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  save(
    agent: AgentEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = AgentMapper.toRow(agent);
        const skillDeps = AgentMapper.toSkillDepRows(agent);
        const mcpDeps = AgentMapper.toMcpDepRows(agent);
        const agentDeps = AgentMapper.toAgentDepRows(agent);
        const fileRows = files === undefined ? null : AgentMapper.toFileRows(agent, files);
        this.db.transaction((tx) => {
          tx.insert(agents)
            .values(row)
            .onConflictDoUpdate({
              target: agents.fqn,
              set: {
                origin: row.origin,
                description: row.description,
                version: row.version,
                prereqs: row.prereqs,
                prereqsAck: row.prereqsAck,
                disabledByUser: row.disabledByUser,
                updatedAt: row.updatedAt,
              },
            })
            .run();
          tx.delete(agentSkillDeps).where(eq(agentSkillDeps.sourceFqn, agent.id)).run();
          if (skillDeps.length > 0) tx.insert(agentSkillDeps).values(skillDeps).run();
          tx.delete(agentMcpDeps).where(eq(agentMcpDeps.sourceFqn, agent.id)).run();
          if (mcpDeps.length > 0) tx.insert(agentMcpDeps).values(mcpDeps).run();
          tx.delete(agentAgentDeps).where(eq(agentAgentDeps.sourceFqn, agent.id)).run();
          if (agentDeps.length > 0) tx.insert(agentAgentDeps).values(agentDeps).run();
          if (fileRows !== null) {
            tx.delete(agentFiles).where(eq(agentFiles.agentFqn, agent.id)).run();
            if (fileRows.length > 0) tx.insert(agentFiles).values(fileRows).run();
          }
        });
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  delete(id: AgentFqn): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.transaction((tx) => {
          tx.delete(agentFiles).where(eq(agentFiles.agentFqn, id)).run();
          tx.delete(agentSkillDeps).where(eq(agentSkillDeps.sourceFqn, id)).run();
          tx.delete(agentMcpDeps).where(eq(agentMcpDeps.sourceFqn, id)).run();
          tx.delete(agentAgentDeps).where(eq(agentAgentDeps.sourceFqn, id)).run();
          tx.delete(agents).where(eq(agents.fqn, id)).run();
        });
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  list(): ResultAsync<AgentEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const rows = this.db.select().from(agents).orderBy(agents.fqn).all();
        const bucket = (deps: AgentDepRow[]): Map<string, AgentDepRow[]> => {
          const m = new Map<string, AgentDepRow[]>();
          for (const d of deps) {
            const arr = m.get(d.sourceFqn) ?? [];
            arr.push(d);
            m.set(d.sourceFqn, arr);
          }
          return m;
        };
        const s = bucket(this.db.select().from(agentSkillDeps).all());
        const m = bucket(this.db.select().from(agentMcpDeps).all());
        const a = bucket(this.db.select().from(agentAgentDeps).all());
        return rows.map((r) =>
          AgentMapper.toDomain(r, s.get(r.fqn) ?? [], m.get(r.fqn) ?? [], a.get(r.fqn) ?? []),
        );
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  getAnchor(id: AgentFqn): ResultAsync<string, AgentNotFound | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db
          .select({ content: agentFiles.content })
          .from(agentFiles)
          .where(and(eq(agentFiles.agentFqn, id), eq(agentFiles.relPath, "AGENTS.md")))
          .get();
        return row?.content.toString("utf8");
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    ).andThen(
      (content): ResultAsync<string, AgentNotFound | DatabaseUnavailable> =>
        content === undefined ? errAsync({ type: "AgentNotFound", fqn: id }) : okAsync(content),
    );
  }

  listFilePaths(id: AgentFqn): ResultAsync<CatalogFileEntry[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const rows = this.db
          .select({ relPath: agentFiles.relPath, content: agentFiles.content })
          .from(agentFiles)
          .where(eq(agentFiles.agentFqn, id))
          .orderBy(agentFiles.relPath)
          .all();
        return rows.map((row) => ({ relPath: row.relPath, size: row.content.byteLength }));
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  getFile(id: AgentFqn, relPath: string): ResultAsync<Buffer | null, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = this.db
          .select({ content: agentFiles.content })
          .from(agentFiles)
          .where(and(eq(agentFiles.agentFqn, id), eq(agentFiles.relPath, relPath)))
          .get();
        return row?.content ?? null;
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  async *streamFiles(id: AgentFqn): AsyncIterable<CatalogFile> {
    const rows = this.db
      .select({ relPath: agentFiles.relPath, content: agentFiles.content })
      .from(agentFiles)
      .where(eq(agentFiles.agentFqn, id))
      .orderBy(agentFiles.relPath)
      .all();
    for (const row of rows) yield row;
  }

  existsUsingSkill(skill: SkillFqn): ResultAsync<boolean, DatabaseUnavailable> {
    return this.existsWithTarget(agentSkillDeps, skill);
  }

  existsUsingMcp(mcp: McpFqn): ResultAsync<boolean, DatabaseUnavailable> {
    return this.existsWithTarget(agentMcpDeps, mcp);
  }

  existsUsingAgent(agent: AgentFqn): ResultAsync<boolean, DatabaseUnavailable> {
    return this.existsWithTarget(agentAgentDeps, agent);
  }

  /**
   * Indexed existence probe: is there any dep row in `table` whose
   * `target_fqn` equals `target`? `limit(1)` short-circuits at the first
   * match (the `*_tgt_idx` index covers it), so no rows are materialised
   * beyond a single hit.
   */
  private existsWithTarget(
    table: typeof agentSkillDeps | typeof agentMcpDeps | typeof agentAgentDeps,
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
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }
}
