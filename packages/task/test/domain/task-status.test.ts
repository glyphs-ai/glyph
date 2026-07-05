import { describe, expect, it } from "vitest";
import { TaskStatusSchema, TERMINAL_TASK_STATUSES } from "../../src/domain/task-status.js";

describe("TERMINAL_TASK_STATUSES", () => {
  it("lists exactly the non-running statuses (stays in lock-step with the status enum)", () => {
    // `satisfies readonly TerminalStatus[]` proves each entry IS terminal, but
    // not that ALL terminal statuses are present. Guard completeness here so a
    // new terminal status added to the enum can't silently be treated as
    // in-flight by the repository's `notInArray` queries.
    const nonRunning = TaskStatusSchema.options.filter((status) => status !== "running");
    expect([...TERMINAL_TASK_STATUSES].sort()).toEqual([...nonRunning].sort());
  });
});
