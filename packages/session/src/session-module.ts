import { randomBytes as cryptoRandomBytes } from "node:crypto";
import type { AgentContentSource, RuntimeRegistry } from "@glyphs-ai/runtime";
import type { Spawner } from "@glyphs-ai/terminal";
import { BuildInteractiveLaunchUseCase } from "./application/build-interactive-launch.js";
import { CreateSessionUseCase } from "./application/create-session.js";
import { DeleteSessionUseCase } from "./application/delete-session.js";
import { GetSessionUseCase } from "./application/get-session.js";
import { ListSessionsUseCase } from "./application/list-sessions.js";
import type { AgentResolver } from "./application/ports/agent-resolver.js";
import { SpawnInteractiveUseCase } from "./application/spawn-interactive.js";
import type { Db } from "./infrastructure/drizzle/session-db.js";
import { DrizzleSessionQueries } from "./infrastructure/drizzle/session-queries.js";
import { DrizzleSessionRepository } from "./infrastructure/drizzle/session-repository.js";
import { LocalSessionSandbox, sessionsRoot } from "./infrastructure/file/local-session-sandbox.js";

/**
 * Public surface of the session package: a DI container of use-case
 * instances plus `close`. Consumers call `module.<useCase>.execute(...)`;
 * there is no service facade.
 */
export interface SessionModule {
  readonly createSession: CreateSessionUseCase;
  readonly listSessions: ListSessionsUseCase;
  readonly getSession: GetSessionUseCase;
  readonly deleteSession: DeleteSessionUseCase;
  readonly buildInteractiveLaunch: BuildInteractiveLaunchUseCase;
  readonly spawnInteractive: SpawnInteractiveUseCase;
  /** No-op: the host owns the shared connection. Kept for lifecycle symmetry. */
  close(): Promise<void>;
}

export type SessionModuleOptions = {
  readonly db: Db;
  /** Resolves catalog agents (adapter over `@glyphs-ai/catalog`, wired by the host). */
  readonly agentResolver: AgentResolver;
  /** Supplies agent/skill/mcp bytes to `runtime.provision` (catalog satisfies it). */
  readonly contentSource: AgentContentSource;
  /** Result-based runtime registry (`@glyphs-ai/runtime`); must contain at least the default runtime. */
  readonly runtimeRegistry: RuntimeRegistry;
  /** Hosts a launch command (`@glyphs-ai/terminal`'s `localSpawner`, wired by the host). */
  readonly spawner: Spawner;
  readonly workspaceDir: string;
  readonly workspaceId: string;
  /** Test seam: clock for id generation + timestamps. */
  readonly now?: () => Date;
  /** Test seam: random byte source for id generation. */
  readonly randomBytes?: (n: number) => Buffer;
};

/**
 * Assemble the module around a caller-provided drizzle handle over the
 * per-workspace `workspace.db`. The host owns the connection; package tests
 * build one via `openTestDb` in `test/testing.ts`.
 */
export async function composeSessionModule(opts: SessionModuleOptions): Promise<SessionModule> {
  const { db } = opts;
  const repo = new DrizzleSessionRepository({ db });
  const query = new DrizzleSessionQueries({ db });
  const runtimeRegistry = opts.runtimeRegistry;
  const sandbox = new LocalSessionSandbox({ root: sessionsRoot(opts.workspaceDir) });
  const now = opts.now ?? (() => new Date());
  const randomBytes = opts.randomBytes ?? cryptoRandomBytes;

  const buildInteractiveLaunch = new BuildInteractiveLaunchUseCase({
    repo,
    runtimeRegistry,
    sandbox,
    workspaceId: opts.workspaceId,
    workspaceDir: opts.workspaceDir,
  });

  return {
    createSession: new CreateSessionUseCase({
      repo,
      runtimeRegistry,
      sandbox,
      agentResolver: opts.agentResolver,
      contentSource: opts.contentSource,
      workspaceDir: opts.workspaceDir,
      now,
      randomBytes,
    }),
    listSessions: new ListSessionsUseCase({ query, runtimeRegistry, sandbox }),
    getSession: new GetSessionUseCase({ query, runtimeRegistry, sandbox }),
    deleteSession: new DeleteSessionUseCase({ repo, runtimeRegistry, sandbox }),
    buildInteractiveLaunch,
    spawnInteractive: new SpawnInteractiveUseCase({
      buildInteractiveLaunch,
      spawner: opts.spawner,
    }),
    async close() {
      // The host owns the shared connection; the module holds no handle to close.
    },
  };
}
