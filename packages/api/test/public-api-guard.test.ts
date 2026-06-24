/**
 * Compile-time public API guard for `@glyphs-ai/api`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the package-root
 *   orchestration and public error exports.
 *
 * WHY it is valuable:
 *   The server imports these classes from the package root for route
 *   error policies. Locking the public shape here makes accidental
 *   renames surface as a compile-time test failure rather than a
 *   downstream runtime surprise.
 */

import { describe, expectTypeOf, it } from "vitest";
import {
  type Application,
  composeApplication,
  TaskScheduleTargetError,
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
  WorkflowHumanSpecError,
  WorkflowScheduleTargetError,
  WorkflowWorkerNotInCoordMenuError,
  WorkflowWorkerSpecError,
  type WorkspaceContext,
  type WorkspaceContextState,
  WorkspaceHasLiveTasksError,
  WorkspaceLoadError,
} from "../src/index.js";

describe("@glyphs-ai/api public API guard", () => {
  it("exposes the application composition surface", () => {
    expectTypeOf(composeApplication).toBeFunction();
    expectTypeOf<Application>().toHaveProperty("getContext");
    expectTypeOf<Application>().toHaveProperty("peekContextState");
    expectTypeOf<Application>().toHaveProperty("close");
    expectTypeOf<WorkspaceContext>().toHaveProperty("tasks");
    expectTypeOf<WorkspaceContext>().toHaveProperty("workflows");
    expectTypeOf<WorkspaceContextState>().toEqualTypeOf<
      "cached" | "loading" | "unloaded" | "not-registered"
    >();
  });

  it("exposes public error classes with canonical .name values", () => {
    const errors = [
      new WorkspaceHasLiveTasksError("ws", 1),
      new WorkspaceLoadError("ws", new Error("cause")),
      new TaskScheduleTargetError("bad target"),
      new WorkflowScheduleTargetError("bad workflow target"),
      new WorkflowCoordAgentNotCapableError("official/coord"),
      new WorkflowCoordSpecError("bad coord"),
      new WorkflowWorkerSpecError("bad worker"),
      new WorkflowHumanSpecError("bad human"),
      new WorkflowWorkerNotInCoordMenuError("official/worker", "official/coord", [
        "official/other",
      ]),
    ];
    for (const err of errors) {
      expectTypeOf(err).toExtend<Error>();
      expectTypeOf(err.name).toBeString();
    }
  });
});
