import { desc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  WorkspaceIdConflict,
  WorkspacePathConflict,
  WorkspaceRepository,
} from "../../domain/workspace-repository.js";
import type { Db } from "./workspace-db.js";
import { WorkspaceMapper } from "./workspace-mapper.js";
import { workspaces } from "./workspace-schema.js";

/** Drizzle-backed adapter for {@link WorkspaceRepository}. */
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static buildLastOpenedOrderBy() {
    return [desc(workspaces.lastOpenedAt), desc(workspaces.createdAt), workspaces.id];
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  findById(id: WorkspaceId): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(workspaces).where(eq(workspaces.id, id)).get())(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map((row) => (row ? WorkspaceMapper.toDomain(row) : undefined));
  }

  findByPath(workspaceDir: string): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db.select().from(workspaces).where(eq(workspaces.workspaceDir, workspaceDir)).get())(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map((row) => (row ? WorkspaceMapper.toDomain(row) : undefined));
  }

  findAllByLastOpened(): ResultAsync<WorkspaceEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select()
          .from(workspaces)
          .orderBy(...DrizzleWorkspaceRepository.buildLastOpenedOrderBy())
          .all())(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map((rows) => rows.map((row) => WorkspaceMapper.toDomain(row)));
  }

  findLastOpened(): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select()
          .from(workspaces)
          .orderBy(...DrizzleWorkspaceRepository.buildLastOpenedOrderBy())
          .limit(1)
          .get())(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map((row) => (row ? WorkspaceMapper.toDomain(row) : undefined));
  }

  findLastOpenedId(): ResultAsync<WorkspaceId | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select({ id: workspaces.id })
          .from(workspaces)
          .orderBy(...DrizzleWorkspaceRepository.buildLastOpenedOrderBy())
          .limit(1)
          .get())(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map((row) => row?.id as WorkspaceId | undefined);
  }

  insert(
    entity: WorkspaceEntity,
  ): ResultAsync<void, DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.insert(workspaces).values(WorkspaceMapper.toRow(entity)).run();
      })(),
      (cause) => this.translateInsertError(cause, entity),
    );
  }

  save(entity: WorkspaceEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db
          .update(workspaces)
          .set(WorkspaceMapper.toRow(entity))
          .where(eq(workspaces.id, entity.id))
          .run();
      })(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    );
  }

  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(workspaces).where(eq(workspaces.id, id)).run();
      })(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    );
  }

  /**
   * Translate SQLite constraint violations into typed domain errors.
   * Pre-flight path checks are best-effort UX; constraints are the
   * race-free backstop.
   */
  private translateInsertError(
    cause: unknown,
    entity: WorkspaceEntity,
  ): DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict {
    const e = cause as { code?: string; message?: string };
    if (typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) {
      const msg = e.message ?? "";
      if (msg.includes("workspaces.id") || e.code.endsWith("PRIMARYKEY")) {
        const err: WorkspaceIdConflict = { type: "WorkspaceIdConflict", id: entity.id };
        return err;
      }
      if (msg.includes("workspaces.workspace_dir")) {
        // Best-effort lookup of the colliding workspace id.
        let existingId: WorkspaceId | undefined;
        try {
          const existing = this.db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.workspaceDir, entity.workspaceDir))
            .get();
          if (existing) existingId = existing.id as WorkspaceId;
        } catch {
          // Best-effort lookup; existingId stays undefined.
        }
        const err: WorkspacePathConflict = {
          type: "WorkspacePathConflict",
          workspaceDir: entity.workspaceDir,
          existingId,
        };
        return err;
      }
    }
    return DrizzleWorkspaceRepository.asDatabaseUnavailable(cause);
  }
}
