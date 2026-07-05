import type { RuntimeExit } from "@glyphs-ai/runtime";
import type { TaskCancellation } from "../../domain/task-cancellation.js";
import type { TaskFailure } from "../../domain/task-failure.js";

/**
 * Maximum chars retained from the agent's final assistant utterance into
 * `TaskSuccess.output`. Caps the persisted row size; the full text stays in
 * the runtime's activity log. Truncated from the **head** so the leading
 * bytes — typically a PR URL or headline — are always preserved.
 */
export const TASK_OUTPUT_MAX_CHARS = 8000;

/**
 * Outcome of classifying a subprocess exit, discriminated by `kind` so the
 * supervisor can dispatch the matching entity transition. `exitCode` /
 * `signal` live strictly inside the `failure` payload.
 */
export type TerminalDecision =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly failure: TaskFailure }
  | { readonly kind: "cancelled"; readonly cancellation: TaskCancellation };

/**
 * Translate a subprocess exit into a typed terminal decision:
 * killReason `cancel` → cancelled/user; `shutdown` → failed/cascade;
 * exit code 0 → succeeded; non-zero or signal → failed/execution.
 */
export function decideTerminal(
  exitInfo: RuntimeExit,
  killReason: "shutdown" | "cancel" | null,
): TerminalDecision {
  if (killReason === "cancel") {
    return { kind: "cancelled", cancellation: { kind: "user", message: "cancelled by user" } };
  }
  if (killReason === "shutdown") {
    return { kind: "failed", failure: { kind: "cascade", message: "server shutdown" } };
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
