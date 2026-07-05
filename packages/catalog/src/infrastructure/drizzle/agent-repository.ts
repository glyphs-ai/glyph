/**
 * Drizzle-backed AgentRepository — the write-side port's adapter (get/save/
 * delete). Read projections live on `CatalogQueries`; this adapter only loads
 * the full aggregate for mutation and persists it.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. Each method wraps its (synchronous better-sqlite3)
 * work in an inline async IIFE so a sync throw surfaces as a promise rejection
 * that `ResultAsync.fromPromise` routes into the `Err` channel. The private
 * `find` loads the entity row + dep edges; `get` turns absence into
 * `AgentNotFound`.
 *
 * `save(agent, files?)` always rewrites the entity row + dep rows; when `files`
 * is given (install) it additionally rewrites `agent_files`, all in one
 * transaction. State-only mutations (enable/disable/ack) omit `files`.
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { AgentEntity } from "../../domain/agent-entity.js";
import type { AgentFqn } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import { AgentMapper } from "./agent-mapper.js";
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
    return this.find(eq(agents.fqn, id)).andThen(
      (agent): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable> =>
        agent === undefined ? errAsync({ type: "AgentNotFound", fqn: id }) : okAsync(agent),
    );
  }

  /** Load the full aggregate (entity row + dep edges) for mutation. */
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
}
