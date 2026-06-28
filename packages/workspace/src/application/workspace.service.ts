import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import pino, { type Logger } from "pino";
import { ZodError } from "zod";
import {
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
} from "../contract/workspace.errors.js";
import {
  RegisterWorkspaceRequestSchema,
  RenameWorkspaceRequestSchema,
  UnregisterWorkspaceRequestSchema,
  WorkspaceIdSchema,
} from "../contract/workspace.schemas.js";
import type {
  RegisterWorkspaceRequest,
  RenameWorkspaceRequest,
  UnregisterWorkspaceRequest,
  Workspace,
} from "../contract/workspace.types.js";
import type { WorkspaceEntity } from "../domain/workspace.entity.js";
import { buildWorkspaceLayout } from "../persistence/workspace.layout.js";
import type { WorkspaceRepository } from "../persistence/workspace.repository.js";

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Project a {@link WorkspaceEntity} to its wire DTO. Maps each wire
 * field explicitly (never spreads the row) so internal-only columns
 * added to the table in future never leak across the wire boundary,
 * and coalesces the nullable `lastOpenedAt` to `createdAt` so consumers
 * never see a tri-state.
 *
 * Lives in application (not `contract/`): it is the glue that renders an
 * internal entity into the published DTO — orchestration, not a
 * published declaration — and it depends on the domain entity, which
 * the contract layer must not.
 */
export function projectWorkspace(entity: WorkspaceEntity): Workspace {
  return {
    id: entity.id,
    name: entity.name,
    workspaceDir: entity.workspaceDir,
    createdAt: entity.createdAt,
    lastOpenedAt: entity.lastOpenedAt ?? entity.createdAt,
  };
}

/**
 * Translates SQLite UNIQUE / PRIMARY KEY constraint violations into
 * typed domain errors. The pre-flight conflict checks in `register`
 * are best-effort UX; this backstop is deterministic and race-free.
 */
async function translateSqliteConstraintError(
  err: unknown,
  ctx: { id: string; workspaceDir: string; repo: WorkspaceRepository },
): Promise<never> {
  const e = err as { code?: string; message?: string };
  if (typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) {
    const msg = e.message ?? "";
    if (msg.includes("workspaces.id") || e.code.endsWith("PRIMARYKEY")) {
      throw new WorkspaceIdConflictError(ctx.id);
    }
    if (msg.includes("workspaces.workspace_dir")) {
      let conflictingId = "<unknown>";
      try {
        const existing = await ctx.repo.findByPath(ctx.workspaceDir);
        if (existing) conflictingId = existing.id;
      } catch {
        // Best-effort lookup; sentinel id stands in.
      }
      throw new WorkspacePathConflictError(ctx.workspaceDir, conflictingId);
    }
  }
  throw err;
}

export interface WorkspaceServiceOpts {
  readonly repo: WorkspaceRepository;
  /**
   * Absolute directory under which `register({ workspaceDir: undefined })`
   * mints `<defaultWorkspaceParent>/<uuid>/`. Injected by the host so the
   * package owns the directory-layout convention while the host owns the
   * root location (`$GLYPH_HOME`).
   */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

/**
 * Workspace use-case API.
 *
 * Exposes the full workspace surface: write commands (`register`,
 * `open`, `rename`, `unregister`) and read projections (`get`,
 * `list`, `getLastOpened`, `getLastOpenedId`). All read paths go
 * through the repository (which returns the pkg-owned
 * `WorkspaceEntity`) and are projected to the wire `Workspace` DTO by
 * coalescing the nullable `lastOpenedAt` to `createdAt` so consumers
 * never see `null`.
 *
 * Layer split:
 *
 *   WorkspaceEntity (repo) → Workspace (wire DTO)
 *
 * The repository hides ORM specifics; the service owns each operation
 * end to end — including the `register` orchestration (minting the id,
 * defaulting the directory) that a thin HTTP/CLI transport would
 * otherwise have to re-implement. The package is self-contained: a
 * caller provides only the wire-shape request.
 *
 * Write methods that touch the filesystem (`register`;
 * `unregister({ purge: true })`) do FS work BEFORE the DB write, but
 * the rationale differs per method:
 *
 *   - `register` mkdir-then-insert: FS work is the side-effect we
 *     cannot rollback, so doing it before the DB write means a crash
 *     mid-register at worst leaves an empty directory (idempotent
 *     retry-friendly) rather than a registry row pointing at a
 *     directory that doesn't exist.
 *
 *   - `unregister({ purge: true })` rm-then-delete: the row is the
 *     only thing that tells us *which* dirs to clean up, so deleting
 *     it first would orphan the directories; rm-first means a crash
 *     leaves the row in place and a re-run of `unregister` finishes
 *     the cleanup (`findById` returning the still-present row drives
 *     the second rm attempt).
 *
 * The pure-DB writes (`open`, `rename`, `unregister({ purge: false })`)
 * skip the FS step entirely.
 *
 * Concurrency: register's pre-flight `findByPath` check is best-effort
 * UX. Two concurrent registers can race past it; the UNIQUE constraint
 * on the `workspaces` table is the deterministic backstop, and the
 * insert is wrapped to translate SQLite constraint errors back into
 * typed domain errors. We do not wrap each call in a SQLite
 * transaction because better-sqlite3 transactions are synchronous —
 * wrapping `mkdir` inside one would hold the writer lock across an IO
 * boundary.
 */
export class WorkspaceService {
  private readonly repo: WorkspaceRepository;
  private readonly defaultWorkspaceParent: string;
  private readonly logger: Logger;

  constructor(opts: WorkspaceServiceOpts) {
    this.repo = opts.repo;
    this.defaultWorkspaceParent = opts.defaultWorkspaceParent;
    this.logger = opts.logger ?? silentLogger;
  }

  // Triaged write-path failure log. User-input rejections — `ZodError`
  // from input-schema parsing, and `WorkspaceError` subclasses
  // (precondition / conflict) — are 4xx-class and emitted at `debug`:
  // routine signal about malformed client input, not actionable noise
  // for ops. Anything else is unexpected and goes through at `warn`.
  private logCommandFailure(command: string, err: unknown): void {
    if (err instanceof ZodError || err instanceof WorkspaceError) {
      this.logger.debug({ command, err }, "command rejected");
    } else {
      this.logger.warn({ command, err }, "command failed");
    }
  }

  // ─── Reads ─────────────────────────────────────────────

  async get(id: string): Promise<Workspace | null> {
    WorkspaceIdSchema.parse(id);
    const entity = await this.repo.findById(id);
    return entity ? projectWorkspace(entity) : null;
  }

  async list(): Promise<Workspace[]> {
    const entities = await this.repo.findAllByLastOpened();
    return entities.map(projectWorkspace);
  }

  async getLastOpened(): Promise<Workspace | null> {
    const entity = await this.repo.findLastOpened();
    return entity ? projectWorkspace(entity) : null;
  }

  async getLastOpenedId(): Promise<string | null> {
    return (await this.repo.findLastOpenedId()) ?? null;
  }

  // ─── Writes ────────────────────────────────────────────

  async register(input: RegisterWorkspaceRequest): Promise<Workspace> {
    this.logger.debug({ command: "register", input }, "handling command");
    try {
      const { name, workspaceDir: rawDir } = RegisterWorkspaceRequestSchema.parse(input);
      const id = randomUUID();
      const workspaceDir =
        rawDir === undefined ? path.join(this.defaultWorkspaceParent, id) : path.resolve(rawDir);

      const byPath = await this.repo.findByPath(workspaceDir);
      if (byPath) throw new WorkspacePathConflictError(workspaceDir, byPath.id);

      // FS-then-DB ordering: we mkdir() before the row insert so the
      // workspace skeleton exists by the time any caller observes the
      // new registry row. An insert failure (constraint race, disk
      // full, etc.) leaves the skeleton on disk; this is benign because
      // a retry either succeeds (idempotent mkdir + fresh insert) or
      // hits the dup-path check above, and an unused empty skeleton
      // costs ~0 bytes and is never seen by listings (registry is the
      // source of truth).
      await mkdir(workspaceDir, { recursive: true });
      const layout = buildWorkspaceLayout(workspaceDir);
      await Promise.all([
        mkdir(layout.sessions, { recursive: true }),
        mkdir(layout.tasks, { recursive: true }),
      ]);

      const now = new Date().toISOString();
      const row: WorkspaceEntity = { id, name, workspaceDir, createdAt: now, lastOpenedAt: now };
      try {
        await this.repo.insert(row);
      } catch (err) {
        await translateSqliteConstraintError(err, { id, workspaceDir, repo: this.repo });
      }

      this.logger.debug({ command: "register", id }, "command handled");
      return projectWorkspace(row);
    } catch (err) {
      this.logCommandFailure("register", err);
      throw err;
    }
  }

  async open(id: string): Promise<void> {
    this.logger.debug({ command: "open", id }, "handling command");
    try {
      WorkspaceIdSchema.parse(id);
      const ws = await this.repo.findById(id);
      if (!ws) throw new WorkspaceNotRegisteredError(id);
      await this.repo.update(id, { lastOpenedAt: new Date().toISOString() });
      this.logger.debug({ command: "open", id }, "command handled");
    } catch (err) {
      this.logCommandFailure("open", err);
      throw err;
    }
  }

  async rename(id: string, input: RenameWorkspaceRequest): Promise<void> {
    this.logger.debug({ command: "rename", id, input }, "handling command");
    try {
      WorkspaceIdSchema.parse(id);
      const { name } = RenameWorkspaceRequestSchema.parse(input);

      const ws = await this.repo.findById(id);
      if (!ws) throw new WorkspaceNotRegisteredError(id);
      if (ws.name === name) {
        this.logger.debug({ command: "rename", id, reason: "noop" }, "command handled");
        return;
      }
      await this.repo.update(id, { name });
      this.logger.debug({ command: "rename", id }, "command handled");
    } catch (err) {
      this.logCommandFailure("rename", err);
      throw err;
    }
  }

  async unregister(id: string, input: UnregisterWorkspaceRequest = {}): Promise<void> {
    this.logger.debug({ command: "unregister", id, input }, "handling command");
    try {
      WorkspaceIdSchema.parse(id);
      const { purge = false } = UnregisterWorkspaceRequestSchema.parse(input);

      const existing = await this.repo.findById(id);
      if (!existing) return; // idempotent

      if (purge) {
        const layout = buildWorkspaceLayout(existing.workspaceDir);
        await Promise.all([
          rm(layout.sessions, { recursive: true, force: true }),
          rm(layout.tasks, { recursive: true, force: true }),
        ]);
      }

      await this.repo.delete(id);
      this.logger.debug({ command: "unregister", id }, "command handled");
    } catch (err) {
      this.logCommandFailure("unregister", err);
      throw err;
    }
  }
}
