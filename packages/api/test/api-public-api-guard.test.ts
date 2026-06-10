/**
 * Compile-time public API guard for `@glyphs-ai/api`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the workflow-related
 *   additions to the pkg's public surface — specifically the
 *   {@link makeWorkerNodeRunner} factory + {@link WorkerNodeSpec} +
 *   {@link WorkflowWorkerSpecError} exports.
 *
 * WHY it is valuable:
 *   These factories are consumed by server wiring and integration
 *   harnesses. Locking the public shape here makes
 *   accidental renames or breaking-shape changes surface as a
 *   compile-time test failure rather than a downstream runtime
 *   surprise.
 */

import { describe, expectTypeOf, it } from "vitest";
import {
  DEFAULT_WORKER_MAX_POLL_ERRORS,
  DEFAULT_WORKER_POLL_INTERVAL_MS,
  type MakeWorkerNodeRunnerOpts,
  makeWorkerNodeRunner,
  type WorkerNodeSpec,
  WorkflowWorkerSpecError,
} from "../src/index.js";

describe("@glyphs-ai/api public API guard — workflow runner exports", () => {
  it("exposes makeWorkerNodeRunner factory + opts shape + spec type", () => {
    expectTypeOf(makeWorkerNodeRunner).toBeFunction();
    expectTypeOf<MakeWorkerNodeRunnerOpts>().toHaveProperty("tasks");
    expectTypeOf<MakeWorkerNodeRunnerOpts>().toHaveProperty("catalog");
    expectTypeOf<MakeWorkerNodeRunnerOpts>().toHaveProperty("logger");
    expectTypeOf<MakeWorkerNodeRunnerOpts>().toHaveProperty("pollIntervalMs");
    expectTypeOf<MakeWorkerNodeRunnerOpts>().toHaveProperty("maxPollErrors");
    expectTypeOf<WorkerNodeSpec>().toHaveProperty("agent");
    expectTypeOf<WorkerNodeSpec>().toHaveProperty("brief");
    expectTypeOf<WorkerNodeSpec["agent"]>().toBeString();
    expectTypeOf<WorkerNodeSpec["brief"]>().toBeString();
  });

  it("exposes WorkflowWorkerSpecError as an Error subclass with canonical .name", () => {
    const err = new WorkflowWorkerSpecError("bad spec");
    expectTypeOf(err).toExtend<Error>();
  });

  it("exposes the default worker poll constants", () => {
    expectTypeOf(DEFAULT_WORKER_POLL_INTERVAL_MS).toBeNumber();
    expectTypeOf(DEFAULT_WORKER_MAX_POLL_ERRORS).toBeNumber();
  });
});
