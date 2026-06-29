import { desc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  InsertWorkspaceError,
  WorkspaceIdConflict,
  WorkspacePathConflict,
  WorkspaceRepository,
} from "../../domain/workspace-repository.js";
import type { Db } from "./workspace-db.js";
import { WorkspaceMapper } from "./workspace-mapper.js";
import { workspaces } from "./workspace-schema.js";

/**
 * Drizzle-backed adapter for {@link WorkspaceRepository}. Sync at the
 * SQLite layer (better-sqlite3 driver); each method wraps a sync call
 * in `ResultAsync` (via an inline async IIFE so sync throws surface as
 * promise rejections that `ResultAsync.fromPromise` can route into the
 * `Err` channel) so the application composes with `andThen` / `match`
 * chains without ad-hoc try/catch.
 *
 * Adapter boundary: public methods speak the domain `WorkspaceEntity`;
 * the row ↔ entity translation is delegated to
 * {@link WorkspaceMapper} so this file stays pure persistence
 * orchestration. The Drizzle row/insert types never cross this
 * boundary.
 *
 * Error translation: this adapter is the only place in the package
 * allowed to inspect SQLite error codes. Driver failures translate to
 * `DatabaseUnavailable`; constraint violations on `insert` translate
 * to the specific business errors `WorkspaceIdConflict` and
 * `WorkspacePathConflict` so the application matches on a closed
 * union instead of poking at SQL state.
 */
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

  insert(entity: WorkspaceEntity): ResultAsync<void, InsertWorkspaceError> {
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
   * Translate SQLite UNIQUE / PRIMARY KEY constraint violations into
   * typed domain errors. The pre-flight `findByPath` check in
   * `register` is best-effort UX; this backstop is deterministic and
   * race-free. The `existingId` for a path conflict is looked up via
   * a sync `select` — if no row matches (rare; the conflict was
   * triggered by a concurrent delete), a sentinel `"<unknown>"` is
   * used so the original conflict is still surfaced.
   */
  private translateInsertError(cause: unknown, entity: WorkspaceEntity): InsertWorkspaceError {
    const e = cause as { code?: string; message?: string };
    if (typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) {
      const msg = e.message ?? "";
      if (msg.includes("workspaces.id") || e.code.endsWith("PRIMARYKEY")) {
        const err: WorkspaceIdConflict = { type: "WorkspaceIdConflict", id: entity.id };
        return err;
      }
      if (msg.includes("workspaces.workspace_dir")) {
        // Best-effort lookup of the colliding workspace's id. The
        // conflict surfaces with `existingId: undefined` if the
        // lookup itself fails — rare; the row clearly exists since
        // the constraint just triggered on it, but a concurrent
        // delete could remove it before this read lands.
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
