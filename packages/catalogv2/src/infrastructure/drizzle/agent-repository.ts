/**
 * Drizzle-backed AgentRepository — the port's adapter.
 *
 * Throw/catch policy: this is the ONLY layer in the package allowed to
 * `try { ... } catch (e) { ... }`. Driver throws (sqlite errors, IO
 * faults) get caught here and converted to
 * `err({ type: "DatabaseUnavailable", cause: e })`.
 *
 * `save(agent, files?)`:
 *   - Always rewrites the entity row + skill_attachments rows.
 *   - When `files` is provided (install path), additionally rewrites
 *     `agent_files` atomically in the same transaction.
 *   - When `files` is omitted (state-only mutations: disable / enable
 *     / rename / attach-skill), the file tree is untouched.
 *
 * `save` is an honest full-aggregate write rather than a column-level
 * patch — drizzle has no change-tracking, so column-level updates
 * would require a per-field repo verb (`setEnabled`, `setName`) which
 * is the `repo.disable(id)` anti-pattern.
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { err, ok, type Result, ResultAsync } from "neverthrow";

import type { AgentEntity, AgentId } from "../../domain/agent-entity.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import { AgentMapper, type SkillAttachmentRow } from "./agent-mapper.js";
import { agentFiles, agentSkills, agents } from "./agent-schema.js";

type Db = BetterSQLite3Database<{
  agents: typeof agents;
  agentSkills: typeof agentSkills;
  agentFiles: typeof agentFiles;
}>;

/** Lift `Promise<Result<T, E>>` to `ResultAsync<T, E>` without re-throwing. */
function lift<T, E>(promise: Promise<Result<T, E>>): ResultAsync<T, E> {
  return new ResultAsync(promise);
}

export class DrizzleAgentRepository implements AgentRepository {
  constructor(private readonly db: Db) {}

  get(id: AgentId): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable> {
    return lift(
      (async (): Promise<Result<AgentEntity, AgentNotFound | DatabaseUnavailable>> => {
        try {
          const row = this.db.select().from(agents).where(eq(agents.id, id)).get();
          if (row === undefined) return err({ type: "AgentNotFound", agentId: id });
          const skillRows = this.db
            .select()
            .from(agentSkills)
            .where(eq(agentSkills.agentId, id))
            .all();
          return ok(AgentMapper.toDomain(row, skillRows));
        } catch (e) {
          return err({ type: "DatabaseUnavailable", cause: e });
        }
      })(),
    );
  }

  save(
    agent: AgentEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable> {
    return lift(
      (async (): Promise<Result<void, DatabaseUnavailable>> => {
        try {
          const row = AgentMapper.toRow(agent);
          const skillRows = AgentMapper.toSkillRows(agent);
          const fileRows = files === undefined ? null : AgentMapper.toFileRows(agent, files);
          this.db.transaction((tx) => {
            tx.insert(agents)
              .values(row)
              .onConflictDoUpdate({
                target: agents.id,
                set: {
                  name: row.name,
                  description: row.description,
                  version: row.version,
                  enabled: row.enabled,
                },
              })
              .run();
            tx.delete(agentSkills).where(eq(agentSkills.agentId, agent.id)).run();
            if (skillRows.length > 0) tx.insert(agentSkills).values(skillRows).run();
            if (fileRows !== null) {
              tx.delete(agentFiles).where(eq(agentFiles.agentId, agent.id)).run();
              if (fileRows.length > 0) tx.insert(agentFiles).values(fileRows).run();
            }
          });
          return ok(undefined);
        } catch (e) {
          return err({ type: "DatabaseUnavailable", cause: e });
        }
      })(),
    );
  }

  delete(id: AgentId): ResultAsync<void, DatabaseUnavailable> {
    return lift(
      (async (): Promise<Result<void, DatabaseUnavailable>> => {
        try {
          this.db.delete(agents).where(eq(agents.id, id)).run();
          return ok(undefined);
        } catch (e) {
          return err({ type: "DatabaseUnavailable", cause: e });
        }
      })(),
    );
  }

  list(): ResultAsync<AgentEntity[], DatabaseUnavailable> {
    return lift(
      (async (): Promise<Result<AgentEntity[], DatabaseUnavailable>> => {
        try {
          const rows = this.db.select().from(agents).orderBy(agents.id).all();
          const attachments = this.db.select().from(agentSkills).all();
          const byAgent = new Map<string, SkillAttachmentRow[]>();
          for (const a of attachments) {
            const bucket = byAgent.get(a.agentId);
            if (bucket) bucket.push(a);
            else byAgent.set(a.agentId, [a]);
          }
          return ok(rows.map((r) => AgentMapper.toDomain(r, byAgent.get(r.id) ?? [])));
        } catch (e) {
          return err({ type: "DatabaseUnavailable", cause: e });
        }
      })(),
    );
  }
}
