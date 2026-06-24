/**
 * Terminal-transition orchestrator for `TaskService`. Owns the logic
 * that classifies a subprocess exit into a typed terminal decision
 * and persists the resulting state-machine transition.
 *
 * Extracted from `_helpers.ts` so that file stays a leaf utility
 * (LiveTask + safeRm) and the terminal-transition concern has its own
 * cohesive SPLIT peer.
 */

import type { Runtime } from "@glyphs-ai/runtime";
import { TASK_ARTIFACT_SUBDIR } from "../framing.js";
import type { TaskEntity } from "../task-entity.js";
import { pickRuntimeSessionId, type TaskServiceCtx } from "../task-service.js";
import type { TaskCancellation, TaskFailure } from "../types.js";
import { listWorkdirFiles } from "../workdir.js";

/**
 * Maximum chars retained from the agent's final assistant utterance
 * into `TaskSuccess.output`. Caps the persisted row size; the full
 * text is preserved in the runtime's activity log. Truncated from the
 * **head** (`slice(0, MAX)`) so the leading bytes — typically a PR
 * URL or headline — are always preserved.
 */
export const TASK_OUTPUT_MAX_CHARS = 8000;

/**
 * Outcome of classifying a subprocess exit. Discriminated by `kind`
 * so {@link applyTerminal} can dispatch typed transitions to the
 * entity. `exitCode` / `signal` live strictly inside the `failure`
 * payload — they are not mirrored onto the task metadata bag.
 */
export type TerminalDecision =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly failure: TaskFailure }
  | { readonly kind: "cancelled"; readonly cancellation: TaskCancellation };

/**
 * Translate a subprocess exit into a typed terminal decision:
 * killReason 'cancel' → cancelled/user; 'shutdown' → failed/cascade;
 * exit code 0 → succeeded; non-zero or signal → failed/execution.
 */
export function decideTerminal(
  exitInfo: { code: number | null; signal: NodeJS.Signals | null },
  killReason: "shutdown" | "cancel" | null,
): TerminalDecision {
  if (killReason === "cancel") {
    return {
      kind: "cancelled",
      cancellation: { kind: "user", message: "cancelled by user" },
    };
  }
  if (killReason === "shutdown") {
    return {
      kind: "failed",
      failure: { kind: "cascade", message: "server shutdown" },
    };
  }
  if (exitInfo.code === 0) {
    return { kind: "succeeded" };
  }
  if (exitInfo.signal !== null) {
    return {
      kind: "failed",
      failure: {
        kind: "execution",
        signal: exitInfo.signal,
        message: `terminated by signal ${exitInfo.signal}`,
      },
    };
  }
  return {
    kind: "failed",
    failure: {
      kind: "execution",
      exitCode: exitInfo.code as number,
      message: `exited with code ${exitInfo.code}`,
    },
  };
}

/**
 * Apply a terminal decision to a running task and persist. `exitCode`
 * / `signal` live strictly inside the `failure` payload (no metadata
 * mirror). Persistence failure is warn-logged but not rethrown — the
 * subprocess is already gone, so callers cannot do anything useful
 * with an error here.
 */
export async function applyTerminal(
  ctx: TaskServiceCtx,
  workdir: string,
  running: TaskEntity,
  decision: TerminalDecision,
): Promise<void> {
  let next: TaskEntity;
  try {
    switch (decision.kind) {
      case "succeeded": {
        const [output, artifacts] = await collectSuccessPayload(ctx, workdir, running);
        next = running.complete({ output, artifacts }, { now: ctx.now().toISOString() });
        break;
      }
      case "failed":
        next = running.fail(decision.failure, { now: ctx.now().toISOString() });
        break;
      case "cancelled":
        next = running.cancel(decision.cancellation, { now: ctx.now().toISOString() });
        break;
    }
    await ctx.repository.save(next);
  } catch (err) {
    ctx.logger.warn({ taskId: running.id, err }, "tasks: failed to persist terminal status");
  }
}

/**
 * Best-effort assembly of the `TaskSuccess` payload at terminal time.
 * Asks the runtime for its last agent-produced activity (capped to
 * {@link TASK_OUTPUT_MAX_CHARS}, head preserved) and lists
 * `<workdir>/artifact/`. Both sub-collectors fan out in parallel;
 * any sub-failure degrades to `null` / `[]` and warns — never blocks
 * the terminal transition.
 */
async function collectSuccessPayload(
  ctx: TaskServiceCtx,
  workdir: string,
  task: TaskEntity,
): Promise<[string | null, readonly string[]]> {
  const runtimeName = task.metadata.runtime;
  const runtimeSessionId = pickRuntimeSessionId(task.metadata);

  const outputP: Promise<string | null> = (async () => {
    if (typeof runtimeName !== "string" || runtimeSessionId === null) return null;
    let runtime: Runtime;
    try {
      runtime = ctx.runtimeRegistry.get(runtimeName);
    } catch {
      return null;
    }
    if (typeof runtime.getLastAgentActivity !== "function") return null;
    try {
      const last = await runtime.getLastAgentActivity(runtimeSessionId);
      if (last === null) return null;
      return last.text.slice(0, TASK_OUTPUT_MAX_CHARS);
    } catch (err) {
      ctx.logger.warn(
        { taskId: task.id, err },
        "tasks: applyTerminal getLastAgentActivity failed; output left null",
      );
      return null;
    }
  })();

  const artifactsP: Promise<readonly string[]> = (async () => {
    try {
      return await listWorkdirFiles(workdir, TASK_ARTIFACT_SUBDIR);
    } catch (err) {
      ctx.logger.warn(
        { taskId: task.id, err },
        "tasks: applyTerminal listWorkdirFiles failed; artifacts left empty",
      );
      return [];
    }
  })();

  return Promise.all([outputP, artifactsP]);
}
