/**
 * Compile-time public API guard for `@glyphs-ai/schedule`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the pkg's public surface
 *   at the TYPE level. Every public method on the service class, every
 *   exported error class, every exported DTO shape, and the
 *   `describeCron` helper get a `expectTypeOf(...)` assertion below.
 *
 * WHY it is valuable:
 *   Silent renames (`registerKind` → `addKind`), accidental method
 *   removals, DTO-field drift, and dropping a per-kind error class all
 *   break downstream pkgs at compile time — but only the downstream
 *   pkg's typecheck sees the failure, which means breakage surfaces in
 *   a sibling PR (or worse, in `dashboard`) instead of in the pkg that
 *   caused it. This guard pulls the failure forward:
 *   `pnpm --filter @glyphs-ai/schedule typecheck` fails the moment the
 *   public surface drifts, BEFORE the downstream consumer notices.
 *
 * WHEN it runs:
 *   - At `pnpm typecheck` time: every `expectTypeOf` assertion is
 *     evaluated by tsc — that is where the real check happens.
 *   - At `pnpm test` time: the file loads and the `describe(...)` /
 *     `it(...)` bodies execute, but `expectTypeOf` is a no-op at
 *     runtime — vitest reports the cases as passing trivially.
 *   - `expectTypeOf` has zero runtime cost; the cost is paid once at
 *     compile time.
 *
 * HOW to extend it:
 *   Every time you ADD / RENAME / REMOVE a public method on the
 *   service, an exported error class, or an exported DTO field,
 *   update the matching `expectTypeOf` line in the SAME PR. Review
 *   enforces the coupling — a public-surface change without a guard
 *   update is a missing assertion.
 *
 * Worked example: see `packages/catalog/test/public-api-guard.test.ts`
 * for a fully-populated version locking 25+ methods and 19 error
 * classes on a real BC.
 */

import type { Logger } from "pino";
import { describe, expectTypeOf, it } from "vitest";
import {
  composeScheduleModule,
  describeCron,
  InvalidCronExprError,
  InvalidJsonPathError,
  InvalidScheduleIdError,
  InvalidTimezoneError,
  type PreviewScheduleResult,
  type Schedule,
  ScheduleEnabledError,
  ScheduleError,
  ScheduleHasInFlightError,
  ScheduleKindAlreadyRegisteredError,
  type ScheduleKindHandler,
  ScheduleKindMismatchError,
  ScheduleKindNotRegisteredError,
  ScheduleKindRegistryFrozenError,
  ScheduleNotFoundError,
  type ScheduleService,
  type ScheduleTargetEnvelope,
  type ScheduleTrigger,
} from "../src/index.js";

describe("@glyphs-ai/schedule public API guard", () => {
  it("exports the concrete error classes with their canonical constructor signatures", () => {
    const errs: Error[] = [
      new ScheduleError("boom"),
      new ScheduleError("boom", { cause: new Error("upstream") }),
      new ScheduleNotFoundError("sid"),
      new InvalidScheduleIdError("bad"),
      new InvalidCronExprError("* * * *", "too few fields"),
      new InvalidTimezoneError("Mars/Olympus"),
      new ScheduleEnabledError("sid"),
      new ScheduleHasInFlightError("sid"),
      new ScheduleKindMismatchError("sid", "task", "workflow"),
      new ScheduleKindAlreadyRegisteredError("task"),
      new ScheduleKindNotRegisteredError("task"),
      new ScheduleKindNotRegisteredError("task", "custom message"),
      new ScheduleKindRegistryFrozenError("workflow"),
      new InvalidJsonPathError("$..bad"),
    ];
    expectTypeOf(errs[0]!).toExtend<Error>();
  });

  it("preserves the public DTO shapes", () => {
    // Schedule wire DTO — projected by the server to a kind-specific
    // shape; a rename here breaks both the projection and the dashboard.
    expectTypeOf<Schedule>().toHaveProperty("id");
    expectTypeOf<Schedule>().toHaveProperty("name");
    expectTypeOf<Schedule>().toHaveProperty("trigger");
    expectTypeOf<Schedule>().toHaveProperty("target");
    expectTypeOf<Schedule>().toHaveProperty("enabled");
    expectTypeOf<Schedule>().toHaveProperty("createdAt");
    expectTypeOf<Schedule>().toHaveProperty("updatedAt");

    // Opaque envelope persisted for every row.
    expectTypeOf<ScheduleTargetEnvelope>().toHaveProperty("kind");
    expectTypeOf<ScheduleTargetEnvelope>().toHaveProperty("data");

    // Trigger discriminator — only "cron" today.
    expectTypeOf<ScheduleTrigger>().toHaveProperty("kind");
    expectTypeOf<ScheduleTrigger>().toHaveProperty("expr");
    expectTypeOf<ScheduleTrigger>().toHaveProperty("tz");

    // Open-registry per-kind handler — the substrate calls these by
    // name; renaming any method silently breaks every registered handler.
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("validate");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("mergePatch");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("dispatch");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("hasInFlightForSchedule");
    expectTypeOf<ScheduleKindHandler>().toHaveProperty("deleteForSchedule");

    // preview() return shape — dashboard renders both fields.
    expectTypeOf<PreviewScheduleResult>().toHaveProperty("describe");
    expectTypeOf<PreviewScheduleResult>().toHaveProperty("nextRuns");
  });

  it("preserves the ScheduleService class and its public method names", () => {
    expectTypeOf<ScheduleService>().toHaveProperty("registerKind");
    expectTypeOf<ScheduleService>().toHaveProperty("get");
    expectTypeOf<ScheduleService>().toHaveProperty("list");
    expectTypeOf<ScheduleService>().toHaveProperty("create");
    expectTypeOf<ScheduleService>().toHaveProperty("patch");
    expectTypeOf<ScheduleService>().toHaveProperty("delete");
    expectTypeOf<ScheduleService>().toHaveProperty("run");
    expectTypeOf<ScheduleService>().toHaveProperty("preview");
    expectTypeOf<ScheduleService>().toHaveProperty("recover");
    expectTypeOf<ScheduleService>().toHaveProperty("shutdown");
    expectTypeOf<ScheduleService["create"]>().parameters.toEqualTypeOf<
      [
        {
          readonly name: string;
          readonly trigger: ScheduleTrigger;
          readonly target: ScheduleTargetEnvelope;
          readonly enabled?: boolean;
        },
      ]
    >();
    expectTypeOf<ScheduleService["patch"]>().parameters.toEqualTypeOf<
      [
        string,
        {
          readonly name?: string;
          readonly trigger?: ScheduleTrigger;
          readonly enabled?: boolean;
          readonly target?: { readonly patch: unknown };
          readonly expectedKind?: string;
        },
      ]
    >();
    expectTypeOf<ScheduleService["preview"]>().parameters.toEqualTypeOf<
      [{ readonly expr: string; readonly tz: string; readonly n?: number }]
    >();
  });

  it("preserves the re-exported describeCron helper", () => {
    expectTypeOf(describeCron).toBeFunction();
  });

  it("preserves the composition surface", () => {
    expectTypeOf(composeScheduleModule).parameters.toEqualTypeOf<
      [{ readonly dbFile: string; readonly logger?: Logger }]
    >();

    expectTypeOf<Awaited<ReturnType<typeof composeScheduleModule>>>().toHaveProperty("service");
    expectTypeOf<Awaited<ReturnType<typeof composeScheduleModule>>>().toHaveProperty("close");
  });
});
