/**
 * Drizzle-backed AgentRepository — the write-side port's adapter (get/save/
 * delete). Read projections live on `CatalogQueries`; this adapter only loads
 * the full aggregate for mutation and persists it.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. Each method wraps its work in an inline async IIFE so
 * driver failures surface as promise rejections that
 * `ResultAsync.fromPromise` routes into the `Err` channel. The private `find`
 * loads the entity row + dep edges; `get` turns absence into `AgentNotFound`.
 *
 * `save(agent, files?)` always rewrites the entity row + dep rows; when `files`
 * is given (install) it additionally rewrites `agent_files`, all in one
 * transaction. State-only mutations (enable/disable/ack) omit `files`.
 */

import { eq } from "drizzle-orm";
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
import type { Db } from "./catalog-db.js";

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
        const row = await this.db.select().from(agents).where(where).get();
        if (row === undefined) return undefined;
        const sDeps = await this.db
          .select()
          .from(agentSkillDeps)
          .where(eq(agentSkillDeps.sourceFqn, row.fqn))
          .all();
        const mDeps = await this.db
          .select()
          .from(agentMcpDeps)
          .where(eq(agentMcpDeps.sourceFqn, row.fqn))
          .all();
        const aDeps = await this.db
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
        await this.db
          .insert(agents)
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
        await this.db.delete(agentSkillDeps).where(eq(agentSkillDeps.sourceFqn, agent.id)).run();
        if (skillDeps.length > 0) {
          await this.db.insert(agentSkillDeps).values(skillDeps).run();
        }
        await this.db.delete(agentMcpDeps).where(eq(agentMcpDeps.sourceFqn, agent.id)).run();
        if (mcpDeps.length > 0) {
          await this.db.insert(agentMcpDeps).values(mcpDeps).run();
        }
        await this.db.delete(agentAgentDeps).where(eq(agentAgentDeps.sourceFqn, agent.id)).run();
        if (agentDeps.length > 0) {
          await this.db.insert(agentAgentDeps).values(agentDeps).run();
        }
        if (fileRows !== null) {
          await this.db.delete(agentFiles).where(eq(agentFiles.agentFqn, agent.id)).run();
          if (fileRows.length > 0) {
            await this.db.insert(agentFiles).values(fileRows).run();
          }
        }
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }

  delete(id: AgentFqn): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        await this.db.delete(agentFiles).where(eq(agentFiles.agentFqn, id)).run();
        await this.db.delete(agentSkillDeps).where(eq(agentSkillDeps.sourceFqn, id)).run();
        await this.db.delete(agentMcpDeps).where(eq(agentMcpDeps.sourceFqn, id)).run();
        await this.db.delete(agentAgentDeps).where(eq(agentAgentDeps.sourceFqn, id)).run();
        await this.db.delete(agents).where(eq(agents.fqn, id)).run();
      })(),
      DrizzleAgentRepository.asDatabaseUnavailable,
    );
  }
}
