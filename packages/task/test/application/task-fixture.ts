/**
 * Shared fixtures for the application-layer tests: a headless runtime fake
 * whose exit timing the test drives, plus a `TaskSupervisor` wired to a real
 * in-memory SQLite repository and a real tmp-dir workspace. File name does not
 * end in `.test.ts`, so vitest never runs it as a suite.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentActivity,
  AgentContentSource,
  BuildInteractiveLaunchOpts,
  ResolvedAgent,
  Runtime,
  RuntimeExit,
  RuntimeHandle,
} from "@glyphs-ai/runtime";
import { InMemoryRuntimeRegistry } from "@glyphs-ai/runtime";
import { okAsync } from "neverthrow";
import type { Logger } from "pino";
import { mock } from "vitest-mock-extended";
import { InMemoryLiveProcessRegistry } from "../../src/application/supervision/in-memory-live-process-registry.js";
import {
  type RunDispatchArgs,
  TaskSupervisor,
} from "../../src/application/supervision/task-supervisor.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import type { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import { TERMINAL_TASK_STATUSES } from "../../src/domain/task-status.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";
import { LocalTaskSandbox, tasksRoot } from "../../src/infrastructure/file/local-task-sandbox.js";

export const RESOLVED: ResolvedAgent = { agent: { fqn: "demo" }, skills: [], mcps: [] };

/** One spawned handle; the test resolves its exit and observes kills. */
export interface FakeHandleRec {
  killCount: number;
  resolveExit: (info: RuntimeExit) => void;
}

/**
 * Headless runtime whose `launchHeadless` returns a handle whose `exit`
 * promise the test resolves by hand. `autoExitOnKill` mirrors real
 * child_process behaviour (kill → exit fires after a microtask).
 */
export class FakeHeadlessRuntime implements Runtime {
  readonly kind = "copilot";
  readonly handles: FakeHandleRec[] = [];
  readonly deleteStateCalls: string[] = [];
  agentOutput: AgentActivity | null = {
    text: "PR: https://example.test/pr/1",
    timestamp: "2026-05-08T02:00:00.000Z",
  };
  autoExitOnKill = false;
  private next = 0;

  launchHeadless: NonNullable<Runtime["launchHeadless"]> = () => {
    const n = ++this.next;
    let resolveExit!: (info: RuntimeExit) => void;
    const exit = new Promise<RuntimeExit>((res) => {
      resolveExit = res;
    });
    const rec: FakeHandleRec = { killCount: 0, resolveExit };
    this.handles.push(rec);
    const handle: RuntimeHandle = {
      runtimeSessionId: `rsid-${n}`,
      sessionDir: Promise.resolve("/tmp/session"),
      exit,
      kill: () => {
        rec.killCount++;
        if (this.autoExitOnKill)
          queueMicrotask(() => resolveExit({ code: null, signal: "SIGTERM" }));
      },
    };
    return okAsync(handle);
  };

  provision() {
    return okAsync({ runtimeSessionId: null });
  }

  buildInteractiveLaunch(_rsid: string | null, opts: BuildInteractiveLaunchOpts) {
    return okAsync({ cmd: "stub", args: [], cwd: opts.workdir, display: "stub" });
  }

  readMetadata() {
    return okAsync(null);
  }

  getLastAgentActivity() {
    return okAsync(this.agentOutput);
  }

  deleteState(runtimeSessionId: string) {
    this.deleteStateCalls.push(runtimeSessionId);
    return okAsync(undefined);
  }
}

export interface SupervisorFixture {
  readonly supervisor: TaskSupervisor;
  readonly repo: DrizzleTaskRepository;
  readonly sandbox: LocalTaskSandbox;
  readonly runtime: FakeHeadlessRuntime;
  readonly registry: InMemoryRuntimeRegistry;
  readonly workspaceDir: string;
  readonly now: () => Date;
  cleanup(): void;
}

export async function buildSupervisorFixture(
  opts: { logger?: Logger; autoExitOnKill?: boolean } = {},
): Promise<SupervisorFixture> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "task-sup-"));
  // The workspace provisioner pre-creates `<workspaceDir>/tasks/` in prod;
  // reserve uses {recursive:false} so the test must create it too.
  mkdirSync(tasksRoot(workspaceDir), { recursive: true });
  const { db, close } = await openDb(":memory:");
  const repo = new DrizzleTaskRepository({ db });
  const sandbox = new LocalTaskSandbox({ root: tasksRoot(workspaceDir) });
  const runtime = new FakeHeadlessRuntime();
  if (opts.autoExitOnKill) runtime.autoExitOnKill = true;
  const registry = new InMemoryRuntimeRegistry();
  registry.register(runtime);
  const liveProcesses = new InMemoryLiveProcessRegistry();
  const now = () => new Date("2026-05-08T01:05:00.000Z");
  const supervisor = new TaskSupervisor({
    repository: repo,
    runtimeRegistry: registry,
    sandbox,
    liveProcesses,
    contentSource: mock<AgentContentSource>(),
    workspaceId: "ws-1",
    workspaceDir,
    now,
    logger: opts.logger ?? mock<Logger>(),
  });
  return {
    supervisor,
    repo,
    sandbox,
    runtime,
    registry,
    workspaceDir,
    now,
    cleanup() {
      close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

/** A prepared dispatch input with sensible defaults; override per test. */
export function dispatchArgs(overrides: Partial<RunDispatchArgs> = {}): RunDispatchArgs {
  return {
    id: TaskIdSchema.parse("20260508-00000001"),
    agent: "public/demo",
    resolved: RESOLVED,
    runtime: new FakeHeadlessRuntime(),
    framingPrompt: "read TASK.md then exit",
    brief: TaskBriefSchema.parse("do it"),
    details: undefined,
    origin: "standalone",
    originId: undefined,
    metadata: undefined,
    subprocessEnv: undefined,
    ...overrides,
  };
}

/** Capture pino-shaped warn calls synchronously into an in-memory list. */
export function captureLogger(): { calls: { msg: string; meta?: object }[]; logger: Logger } {
  const calls: { msg: string; meta?: object }[] = [];
  const logger = {
    warn: (meta: object | string, msg?: string) => {
      if (typeof meta === "string") calls.push({ msg: meta });
      else calls.push({ msg: msg ?? "", meta });
    },
  } as unknown as Logger;
  return { calls, logger };
}

/** Poll the repository until `id` reaches a terminal status. */
export async function awaitTerminal(repo: DrizzleTaskRepository, id: TaskId): Promise<TaskEntity> {
  for (let i = 0; i < 100; i++) {
    const found = await repo.get(id);
    if (
      found.isOk() &&
      (TERMINAL_TASK_STATUSES as readonly string[]).includes(found.value.status)
    ) {
      return found.value;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`awaitTerminal: task ${id} never reached terminal`);
}
