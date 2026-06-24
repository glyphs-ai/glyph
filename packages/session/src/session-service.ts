/**
 * @glyphs-ai/session — `SessionService` facade.
 *
 * Thin orchestrator class. Each public method delegates to one of
 * three concern-specific modules under `./session-service/`:
 *   - `create.ts`   — rollback-heavy provisioning path
 *   - `refresh.ts`  — projection/refresh internals, list/get
 *   - `spawn.ts`    — launch-command assembly + terminal spawn
 *
 * Shared state lives in a single `SessionServiceCtx` object built in
 * the constructor and passed to every internal function. The
 * `session-service/` subdir is implementation detail — not re-exported
 * from `./index.ts`.
 */

import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { LaunchCommand } from "@glyphs-ai/runtime";
import pino from "pino";
import { SessionNotFoundError, SpawnFnNotInjectedError } from "./errors.js";
import { safeJoinUnderRoot, sessionsRoot } from "./paths.js";
import type { SessionEntity } from "./session-entity.js";
import { SessionRepository } from "./session-repository.js";
import type { SessionServiceCtx } from "./session-service/_helpers.js";
import { createSession } from "./session-service/create.js";
import { draftFromEntity, loadSession, refreshSession } from "./session-service/refresh.js";
import { buildInteractiveLaunch } from "./session-service/spawn.js";
import type {
  BuildInteractiveLaunchSessionOpts,
  CreateSessionOpts,
  DeleteSessionOpts,
  ListSessionOpts,
  Session,
  SessionServiceOpts,
  SpawnSessionResult,
} from "./types.js";
import { assertValidSessionId } from "./validate.js";

const silentLogger = pino({ level: "silent" });

/**
 * Per-session workdir manager.
 *
 * Persistence is backed by Drizzle via `SessionRepository` against the
 * per-workspace `workspace.db`. Live activity (`lastActiveAt`,
 * `preview`) is recomputed per call from the runtime registry; workdir
 * paths are resolved from the workspace layout.
 */
export class SessionService {
  private readonly ctx: SessionServiceCtx;

  constructor(opts: SessionServiceOpts) {
    this.ctx = {
      agentResolver: opts.agentResolver,
      contentSource: opts.contentSource,
      runtimeRegistry: opts.runtimeRegistry,
      workspaceDir: path.resolve(opts.workspaceDir),
      sessionsDir: sessionsRoot(path.resolve(opts.workspaceDir)),
      workspaceId: opts.workspaceId,
      logger: opts.logger ?? silentLogger,
      repo: new SessionRepository({ db: opts.db }),
      now: opts.now ?? (() => new Date()),
      randomBytes: opts.randomBytes ?? defaultRandomBytes,
      spawnFn: opts.spawnFn,
    };
  }

  // ─── create ──────────────────────────────────────────────

  async create(opts: CreateSessionOpts): Promise<Session> {
    return createSession(this.ctx, opts);
  }

  // ─── list ────────────────────────────────────────────────

  async list(opts: ListSessionOpts = {}): Promise<Session[]> {
    const repoOpts: { createdSince?: string; agent?: string } = {};
    if (opts.createdSince !== undefined) repoOpts.createdSince = opts.createdSince;
    if (opts.agent !== undefined) repoOpts.agent = opts.agent;
    let entries: SessionEntity[];
    try {
      entries = await this.ctx.repo.findAll(repoOpts);
    } catch (err) {
      this.ctx.logger.warn({ err }, "sessions: repository.findAll failed");
      return [];
    }

    const drafts = await Promise.all(entries.map((row) => draftFromEntity(this.ctx, row)));
    const survivors: Session[] = [];
    for (const draft of drafts) {
      if (draft === null) continue;
      survivors.push(draft);
    }

    const refreshed = await Promise.all(survivors.map((s) => refreshSession(this.ctx, s)));

    const filtered =
      opts.activeSince !== undefined
        ? refreshed.filter((s) => {
            const since = opts.activeSince as string;
            if (s.lastActiveAt !== null) return s.lastActiveAt >= since;
            return s.createdAt >= since;
          })
        : refreshed;

    filtered.sort((a, b) => {
      const aNull = a.lastActiveAt === null;
      const bNull = b.lastActiveAt === null;
      if (aNull !== bNull) return aNull ? -1 : 1;
      if (aNull && bNull) {
        const d = b.createdAt.localeCompare(a.createdAt);
        return d !== 0 ? d : b.id.localeCompare(a.id);
      }
      const d = (b.lastActiveAt as string).localeCompare(a.lastActiveAt as string);
      return d !== 0 ? d : b.id.localeCompare(a.id);
    });
    return filtered;
  }

  // ─── get ─────────────────────────────────────────────────

  async get(id: string): Promise<Session | null> {
    assertValidSessionId(id);
    return loadSession(this.ctx, id);
  }

  // ─── delete ──────────────────────────────────────────────

  async delete(id: string, opts: DeleteSessionOpts = {}): Promise<void> {
    assertValidSessionId(id);

    const session = await loadSession(this.ctx, id);
    if (session === null) {
      throw new SessionNotFoundError(id);
    }

    if (opts.purge === true) {
      const runtime = this.ctx.runtimeRegistry.get(session.runtime);
      if (session.runtimeSessionId !== null) {
        await runtime.deleteState(session.runtimeSessionId);
      }
      const workdir = safeJoinUnderRoot(this.ctx.sessionsDir, id);
      await rm(workdir, { recursive: true, force: true });
      await this.ctx.repo.delete(id);
      return;
    }

    await this.ctx.repo.delete(id);
  }

  // ─── buildInteractiveLaunch ─────────────────────────────

  async buildInteractiveLaunch(
    id: string,
    opts: BuildInteractiveLaunchSessionOpts = {},
  ): Promise<LaunchCommand> {
    return buildInteractiveLaunch(this.ctx, id, opts);
  }

  // ─── spawnInteractive ───────────────────────────────────

  async spawnInteractive(
    id: string,
    opts: BuildInteractiveLaunchSessionOpts = {},
  ): Promise<SpawnSessionResult> {
    if (this.ctx.spawnFn === undefined) {
      throw new SpawnFnNotInjectedError();
    }
    let launch: LaunchCommand;
    try {
      launch = await this.buildInteractiveLaunch(id, opts);
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof Error && err.name ? err.name : "BuildLaunchError",
        display: "",
      };
    }
    try {
      const result = await this.ctx.spawnFn(launch);
      return {
        ok: true as const,
        launcher: result.launcher,
        display: launch.display,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof Error && err.name ? err.name : "SpawnError",
        display: launch.display,
      };
    }
  }
}

function defaultRandomBytes(n: number): Buffer {
  return cryptoRandomBytes(n);
}
