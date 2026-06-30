/**
 * Compile-time public API guard for `@glyphs-ai/terminal`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the package's public
 *   surface at the TYPE level. terminal has no central Service class —
 *   its public surface is the `localSpawner` value, the `Spawner`
 *   interface, the `SpawnFailed` discriminated-union atom, and the DTOs
 *   (`LaunchCommand`, `SpawnResult`). Each gets an `expectTypeOf(...)`
 *   assertion below.
 *
 * WHY it is valuable:
 *   Silent renames, accidental removals, and DTO-field drift on
 *   `LaunchCommand` break downstream packages (`@glyphs-ai/session` via
 *   the structurally-typed `Spawner` seam; `@glyphs-ai/api` which injects
 *   `localSpawner`) at compile time — but only the downstream typecheck
 *   sees it. This guard pulls the failure forward:
 *   `pnpm --filter @glyphs-ai/terminal typecheck` fails the moment the
 *   public surface drifts, BEFORE the consumer notices.
 *
 * WHEN it runs:
 *   - At `pnpm typecheck` time: every `expectTypeOf` is evaluated by tsc.
 *   - At `pnpm test` time: the bodies load but `expectTypeOf` is a no-op.
 *
 * HOW to extend it:
 *   Every time you ADD / RENAME / REMOVE an exported value, interface, or
 *   DTO field, update the matching `expectTypeOf` line in the SAME PR.
 */

import type { ResultAsync } from "neverthrow";
import { describe, expectTypeOf, it } from "vitest";
import {
  type LaunchCommand,
  localSpawner,
  type Spawner,
  type SpawnFailed,
  type SpawnResult,
} from "../src/index.js";

describe("@glyphs-ai/terminal public API guard", () => {
  it("exports localSpawner as the concrete Spawner", () => {
    expectTypeOf(localSpawner).toEqualTypeOf<Spawner>();
    expectTypeOf(localSpawner.spawn).toBeFunction();
    expectTypeOf(localSpawner.spawn).parameters.toEqualTypeOf<[LaunchCommand]>();
    expectTypeOf(localSpawner.spawn).returns.toEqualTypeOf<ResultAsync<SpawnResult, SpawnFailed>>();
  });

  it("preserves the public DTO shapes", () => {
    // LaunchCommand — the SHARED structural seam with @glyphs-ai/session
    // (consumed via the `Spawner` port) and @glyphs-ai/runtime-v2
    // (produced by `Runtime.buildInteractiveLaunch`). Field renames here
    // break both producers and consumers simultaneously.
    expectTypeOf<LaunchCommand>().toHaveProperty("cmd");
    expectTypeOf<LaunchCommand>().toHaveProperty("args");
    expectTypeOf<LaunchCommand>().toHaveProperty("cwd");
    expectTypeOf<LaunchCommand>().toHaveProperty("display");
    expectTypeOf<LaunchCommand>().toHaveProperty("env");

    expectTypeOf<SpawnResult>().toHaveProperty("launcher");
  });

  it("preserves the SpawnFailed discriminated-union atom", () => {
    expectTypeOf<SpawnFailed["type"]>().toEqualTypeOf<"SpawnFailed">();
    expectTypeOf<SpawnFailed>().toHaveProperty("message");
    expectTypeOf<SpawnFailed>().toHaveProperty("code");
  });
});
