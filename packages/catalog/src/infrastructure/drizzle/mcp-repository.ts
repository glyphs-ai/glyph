/**
 * Drizzle-backed McpRepository — the write-side port's adapter (get/save/
 * delete). Read projections live on `CatalogQueries`; this adapter only loads
 * the aggregate for mutation and persists it.
 *
 * Throw/catch policy: the ONLY layer that turns driver faults into
 * `DatabaseUnavailable`. The private `find` loads the row; `get` turns absence
 * into `McpNotFound`. `save` is an honest full-row insert-or-replace — a
 * single-blob MCP has nothing to patch column by column and no file tree.
 */

import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { McpEntity } from "../../domain/mcp-entity.js";
import type { McpFqn } from "../../domain/mcp-fqn.js";
import type {
  DatabaseUnavailable,
  McpNotFound,
  McpRepository,
} from "../../domain/mcp-repository.js";
import type { Db } from "./catalog-db.js";
import { McpMapper } from "./mcp-mapper.js";
import { mcps } from "./mcp-schema.js";

export class DrizzleMcpRepository implements McpRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(fqn: McpFqn): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> {
    return this.find(eq(mcps.fqn, fqn)).andThen(
      (mcp): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable> =>
        mcp === undefined ? errAsync({ type: "McpNotFound", fqn }) : okAsync(mcp),
    );
  }

  /** Load the row for mutation, mapped to the aggregate. */
  private find(
    where: ReturnType<typeof eq>,
  ): ResultAsync<McpEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.select().from(mcps).where(where).get(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    ).map((row) => (row ? McpMapper.toDomain(row) : undefined));
  }

  save(mcp: McpEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = McpMapper.toRow(mcp);
        await this.db
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
        await this.db.delete(mcps).where(eq(mcps.fqn, fqn)).run();
      })(),
      DrizzleMcpRepository.asDatabaseUnavailable,
    );
  }
}
