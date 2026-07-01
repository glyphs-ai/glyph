import type { Runtime, RuntimeHeadlessLaunchFailed } from "@glyphs-ai/runtime";
import { err, errAsync, ok, type Result, safeTry } from "neverthrow";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { TaskEntity } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { type TaskId, TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import type {
  WorkdirMaterializationFailed,
  WorkdirReservationFailed,
} from "../domain/task-sandbox.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type {
  AgentNotFound,
  AgentResolutionFailed,
  AgentResolver,
  BlockedReason,
} from "./ports/agent-resolver.js";
import {
  DEFAULT_RUNTIME,
  type LaunchableRuntime,
  type ManagerShuttingDown,
  type TaskSupervisor,
} from "./supervision/index.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/**
 * Single-line ASCII framing prompt sent to the runtime at spawn time. Kept on
 * ONE line so `cmd.exe` never sees an LF inside the `/c` payload:
 * `ensureSafeFramingPrompt` validates whichever prompt this use-case forwards
 * (this default OR a caller override) on every dispatch, so an edit that breaks
 * the single-line rule fails the dispatch tests (which exercise the default via
 * the no-prompt happy path).
 */
const DEFAULT_TASK_FRAMING_PROMPT =
  "1. Read TASK.md in your current working directory. That is your assignment. 2. Use ./temp/ for intermediate steps and scratch files; nothing in ./temp/ is shown to the user. 3. Save meaningful output to ./artifact/. These files ARE shown to the user. You MUST always produce at least one self-contained HTML file under ./artifact/ (inline all CSS, JS, fonts, images as data URLs; no external links or CDN references; must render correctly when opened directly from disk with no network access) as a human-readable report of your work. This HTML report is in addition to any other outputs your agent instructions or task brief require -- never skip it, never let other outputs replace it. 4. Execute the assignment, then exit.";

/** A framing prompt was not safe to pass through `cmd.exe /c …` as one argv element. */
export type UnsafeFramingPrompt = {
  readonly type: "UnsafeFramingPrompt";
  readonly reason: string;
};

/**
 * Guard the runtime / `cmd.exe` boundary: a framing prompt must contain no LF,
 * no CR, and only printable ASCII (0x20–0x7E). Returns the prompt unchanged
 * when safe, or `UnsafeFramingPrompt` otherwise — run on whichever prompt this
 * use-case forwards (the default OR a caller override) so an unsafe override is
 * rejected pre-spawn.
 */
function ensureSafeFramingPrompt(prompt: string): Result<string, UnsafeFramingPrompt> {
  if (prompt.includes("\n") || prompt.includes("\r") || /[^\x20-\x7E]/.test(prompt)) {
    return err({
      type: "UnsafeFramingPrompt",
      reason: "framing prompt must be single-line printable ASCII",
    });
  }
  return ok(prompt);
}

/**
 * Kernel env keys the dispatch flow always sets on the spawned subprocess. A
 * caller-supplied `subprocessEnv` that carries any of these is rejected
 * pre-spawn (`DispatchKernelEnvCollision`) so domain callers namespace their
 * own env (e.g. `GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`).
 */
const KERNEL_ENV_KEYS: ReadonlySet<string> = new Set([
  "GLYPH_WORKSPACE",
  "GLYPH_WORKSPACE_DIR",
  "GLYPH_WORK_KIND",
  "GLYPH_WORK_ID",
  "GLYPH_WORK_DIR",
]);

/**
 * Mint a fresh task id (`YYYYMMDD-xxxxxxxx`) from the injected clock +
 * randomness. Both are test seams so ids can be pinned; the id is not a
 * precise timestamp (within-day ordering lives in the `createdAt` column).
 * The format is owned by `TaskIdSchema`; this factory produces a value that
 * satisfies it.
 */
export function generateTaskId(now: () => Date, randomBytes: (n: number) => Buffer): TaskId {
  const d = now();
  const date =
    d.getFullYear().toString().padStart(4, "0") +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0");
  return `${date}-${randomBytes(4).toString("hex")}` as TaskId;
}

export const DispatchTaskRequestSchema = z
  .object({
    agent: z.string().min(1),
    brief: z.string().min(1),
    details: z.string().optional(),
    runtime: z.string().optional(),
    origin: z.string().optional(),
    originId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    subprocessEnv: z.record(z.string(), z.string()).optional(),
    prompt: z.string().optional(),
  })
  .strict();
export type DispatchTaskRequest = z.infer<typeof DispatchTaskRequestSchema>;

export const DispatchTaskResponseSchema = z.object({
  id: TaskIdSchema,
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  origin: z.string(),
  originId: z.string().optional(),
  status: TaskStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  success: TaskSuccessSchema.optional(),
  failure: TaskFailureSchema.optional(),
  cancellation: TaskCancellationSchema.optional(),
});
export type DispatchTaskResponse = z.infer<typeof DispatchTaskResponseSchema>;

/** `dispatch`: the chosen runtime is registered but cannot launch headless tasks. */
export type RuntimeDoesNotSupportTasks = {
  readonly type: "RuntimeDoesNotSupportTasks";
  readonly runtime: string;
};

/**
 * `dispatch`: a caller-supplied `subprocessEnv` key collided with one of the
 * kernel env keys the dispatch flow always sets. Callers must namespace their
 * own keys (e.g. `GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`).
 */
export type DispatchKernelEnvCollision = {
  readonly type: "DispatchKernelEnvCollision";
  readonly key: string;
};

/**
 * `dispatch`: the agent (or a transitive dep) is `blocked` — prereqs not
 * acknowledged, disabled by the user, or a missing / blocked skill. Carries
 * the structured `reason` so callers can render "here's what to fix".
 */
export type EntryNotReady = {
  readonly type: "EntryNotReady";
  readonly agent: string;
  readonly reason: BlockedReason | undefined;
};

export type DispatchTaskError =
  | ManagerShuttingDown
  | UnsafeFramingPrompt
  | DispatchKernelEnvCollision
  | AgentNotFound
  | EntryNotReady
  | AgentResolutionFailed
  | RuntimeDoesNotSupportTasks
  // The stateful spawn pipeline's faults (from TaskSupervisor.runDispatch):
  | WorkdirReservationFailed
  | WorkdirMaterializationFailed
  | DatabaseUnavailable
  | RuntimeHeadlessLaunchFailed;

export interface DispatchTaskDeps {
  readonly supervisor: TaskSupervisor;
  readonly agentResolver: AgentResolver;
  readonly runtimeRegistry: import("@glyphs-ai/runtime").RuntimeRegistry;
  readonly now: () => Date;
  readonly randomBytes: (n: number) => Buffer;
}

/**
 * Dispatch a task: refuse while shutting down, validate the framing prompt +
 * caller env, resolve + readiness-check the agent, pick a task-capable
 * runtime, mint the id, and hand off to the supervisor's spawn pipeline. All
 * pre-flight faults surface before any workdir or row is created.
 */
export class DispatchTaskUseCase
  implements UseCase<DispatchTaskRequest, DispatchTaskResponse, DispatchTaskError>
{
  constructor(private readonly deps: DispatchTaskDeps) {}

  execute(request: DispatchTaskRequest): UseCaseResult<DispatchTaskResponse, DispatchTaskError> {
    const parsed = DispatchTaskRequestSchema.parse(request);
    const deps = this.deps;
    const supervisor = deps.supervisor;

    if (supervisor.isShuttingDown) return errAsync({ type: "ManagerShuttingDown" });

    const framing = ensureSafeFramingPrompt(parsed.prompt ?? DEFAULT_TASK_FRAMING_PROMPT);
    if (framing.isErr()) return errAsync(framing.error);
    const framingPrompt = framing.value;

    const collidingKey = firstKernelEnvCollision(parsed.subprocessEnv);
    if (collidingKey !== null) {
      return errAsync({ type: "DispatchKernelEnvCollision", key: collidingKey });
    }

    const runtimeKind = parsed.runtime ?? DEFAULT_RUNTIME;

    return safeTry<DispatchTaskResponse, DispatchTaskError>(async function* () {
      const entry = yield* deps.agentResolver.getEntry(parsed.agent);
      if (entry === null) {
        return err<DispatchTaskResponse, DispatchTaskError>({
          type: "AgentNotFound",
          agent: parsed.agent,
        });
      }
      if (entry.status === "blocked") {
        return err<DispatchTaskResponse, DispatchTaskError>({
          type: "EntryNotReady",
          agent: parsed.agent,
          reason: entry.blockedReason,
        });
      }
      const resolved = yield* deps.agentResolver.resolve(parsed.agent);

      const runtimeResult = deps.runtimeRegistry.get(runtimeKind);
      if (runtimeResult.isErr()) {
        return err<DispatchTaskResponse, DispatchTaskError>({
          type: "RuntimeDoesNotSupportTasks",
          runtime: runtimeKind,
        });
      }
      const runtime = runtimeResult.value;
      if (!isLaunchable(runtime)) {
        return err<DispatchTaskResponse, DispatchTaskError>({
          type: "RuntimeDoesNotSupportTasks",
          runtime: runtime.kind,
        });
      }

      const entity = yield* supervisor.runDispatch({
        id: generateTaskId(deps.now, deps.randomBytes),
        agent: parsed.agent,
        resolved,
        runtime,
        framingPrompt,
        brief: parsed.brief,
        details: parsed.details,
        origin: parsed.origin ?? "standalone",
        originId: parsed.originId,
        metadata: parsed.metadata,
        subprocessEnv: parsed.subprocessEnv,
      });
      return ok<DispatchTaskResponse, DispatchTaskError>(toDispatchTaskResponse(entity));
    });
  }
}

/** First caller env key colliding with a kernel key, or `null` when clean. */
function firstKernelEnvCollision(env: Readonly<Record<string, string>> | undefined): string | null {
  if (env === undefined) return null;
  for (const key of Object.keys(env)) {
    if (KERNEL_ENV_KEYS.has(key)) return key;
  }
  return null;
}

/** Narrow a runtime to one that can launch headless tasks. */
function isLaunchable(runtime: Runtime): runtime is LaunchableRuntime {
  return typeof runtime.launchHeadless === "function";
}

function toDispatchTaskResponse(task: TaskEntity): DispatchTaskResponse {
  return {
    id: task.id,
    agent: task.agent,
    brief: task.brief,
    ...(task.details !== undefined ? { details: task.details } : {}),
    origin: task.origin,
    ...(task.originId !== undefined ? { originId: task.originId } : {}),
    status: task.status,
    metadata: { ...task.metadata },
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
    ...(task.success !== undefined ? { success: task.success } : {}),
    ...(task.failure !== undefined ? { failure: task.failure } : {}),
    ...(task.cancellation !== undefined ? { cancellation: task.cancellation } : {}),
  };
}
