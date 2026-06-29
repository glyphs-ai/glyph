/**
 * Drizzle-backed McpRepository — the port's adapter.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. Each method wraps its (synchronous better-sqlite3)
 * work in an inline async IIFE so a sync throw surfaces as a promise
 * rejection that `ResultAsync.fromPromise` routes into the `Err` channel
 * A shared `find` primitive returns the entity or `undefined`; `get` and
 * `getByOrigin` turn absence into `McpNotFound`.
 *
 * `save` is an honest full-row insert-or-replace — drizzle has no
 * change-tracking, and a single-blob MCP has nothing to patch column by
 * column. MCP saves have no file-tree branch.
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { McpEntity } from "../../domain/mcp-entity.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type {
  DatabaseUnavailable,
  McpNotFound,
  McpRepository,
} from "../../domain/mcp-repository.js";
import type { agentMcpDeps } from "./agent-schema.js";
import { McpMapper } from "./mcp-mapper.js";
import { mcps } from "./mcp-schema.js";
import type { skillMcpDeps } from "./skill-schema.js";

type Db = BetterSQLite3Database<{
  mcps: typeof mcps;
  agentMcpDeps: typeof agentMcpDeps;
  skillMcpDeps: typeof skillMcpDeps;
}>;

export class DrizzleMcpRepository implements McpRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(fqn: McpFqn): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> {
    return this.assertFound(this.findByFqn(fqn), fqn);
  }

  getByOrigin(origin: string): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> {
    return this.assertFound(this.findByOrigin(origin), origin);
  }

  findByFqn(fqn: McpFqn): ResultAsync<McpEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(mcps.fqn, fqn));
  }

  findByOrigin(origin: string): ResultAsync<McpEntity | undefined, DatabaseUnavailable> {
    return this.find(eq(mcps.origin, origin));
  }

  /** Turn a `find` miss into the business `McpNotFound` (keyed by `key`). */
  private assertFound(
    found: ResultAsync<McpEntity | undefined, DatabaseUnavailable>,
    key: string,
  ): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> {
    return found.andThen(
      (mcp): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> =>
        mcp === undefined ? errAsync({ type: "McpNotFound", fqn: key }) : okAsync(mcp),
    );
  }

  /** Shared query primitive: the matching aggregate, or `undefined`. */
  private find(
    where: ReturnType<typeof eq>,
  ): ResultAsync<McpEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(mcps).where(where).get())(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    ).map((row) => (row ? McpMapper.toDomain(row) : undefined));
  }

  save(mcp: McpEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = McpMapper.toRow(mcp);
        this.db
          .insert(mcps)
          .values(row)
          .onConflictDoUpdate({ target: mcps.fqn, set: { origin: row.origin, spec: row.spec } })
          .run();
      })(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    );
  }

  delete(fqn: McpFqn): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(mcps).where(eq(mcps.fqn, fqn)).run();
      })(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    );
  }

  list(): ResultAsync<McpEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(mcps).orderBy(mcps.fqn).all())(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    ).map((rows) => rows.map((r) => McpMapper.toDomain(r)));
  }
}
