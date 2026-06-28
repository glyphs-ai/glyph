/**
 * Compile-time public API guard for `@glyphs-ai/__PKG__`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the pkg's public surface
 *   at the TYPE level. Every public method on the service class, every
 *   exported error class, and every exported DTO / option shape gets a
 *   `expectTypeOf(...)` assertion below.
 *
 * WHY it is valuable:
 *   Silent renames (`installSkill` → `addSkill`), accidental method
 *   removals, and DTO-field drift all break downstream pkgs at
 *   compile time — but only the downstream pkg's typecheck sees the
 *   failure, which means breakage surfaces in a sibling PR (or worse,
 *   in `dashboard`) instead of in the pkg that caused it. This guard
 *   pulls the failure forward: `pnpm --filter @glyphs-ai/__PKG__ typecheck`
 *   fails the moment the public surface drifts, BEFORE the downstream
 *   consumer notices.
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
 * for a fully-populated version on a real BC.
 */

import { describe, expectTypeOf, it } from "vitest";
import {
  type __Entity__,
  __Entity__NotFoundError,
  type Create__Entity__Request,
  type List__Entity__Opts,
} from "../src/contract/index.js";
import {
  type __Entity__Module,
  type __Entity__ModuleOptions,
  type __Entity__Service,
  compose__Entity__Module,
} from "../src/index.js";

describe("@glyphs-ai/__PKG__ public API guard", () => {
  it("exports the concrete error classes with their canonical constructor signatures", () => {
    // Smoke-instantiate each exported error class with its canonical
    // signature; the array's element type acts as a structural check
    // that every class is still constructible the same way it was
    // before. Add a new entry here every time `errors.ts` grows.
    const errs: Error[] = [new __Entity__NotFoundError("some-id")];
    expectTypeOf(errs[0]!).toExtend<Error>();
  });

  it("preserves the public DTO + option shapes", () => {
    // EXAMPLE: in your pkg, list every required field on the wire DTO
    // here. The assertion fails at typecheck time if the field is
    // dropped or renamed in `types.ts`.
    expectTypeOf<__Entity__>().toHaveProperty("id");
    expectTypeOf<__Entity__>().toHaveProperty("name");
    expectTypeOf<__Entity__>().toHaveProperty("createdAt");

    expectTypeOf<Create__Entity__Request>().toHaveProperty("name");
    expectTypeOf<List__Entity__Opts>().toHaveProperty("nameStartsWith");
  });

  it("preserves the __Entity__Service class and its public method names", () => {
    // EXAMPLE: in your pkg, replace `__Entity__Service` with your
    // pkg's service class (e.g. `SessionService`, `CatalogService`)
    // and list every method downstream consumers call by name. The
    // assertion fails at typecheck time if a method is renamed or
    // removed, BEFORE the downstream pkg's typecheck catches it.
    expectTypeOf<__Entity__Service>().toHaveProperty("get");
    expectTypeOf<__Entity__Service>().toHaveProperty("list");
    expectTypeOf<__Entity__Service>().toHaveProperty("create");
    expectTypeOf<__Entity__Service>().toHaveProperty("delete");
  });

  it("preserves the composition surface (compose__Entity__Module + Module + ModuleOptions)", () => {
    // EXAMPLE: in your pkg, assert the compose function's parameter
    // type matches `<Entity>ModuleOptions` and its return type
    // resolves to `<Entity>Module`. Locks the wiring contract that
    // downstream composition roots depend on.
    expectTypeOf(compose__Entity__Module).parameters.toEqualTypeOf<[__Entity__ModuleOptions]>();
    expectTypeOf(compose__Entity__Module).returns.resolves.toEqualTypeOf<__Entity__Module>();

    expectTypeOf<__Entity__Module>().toHaveProperty("service");
    expectTypeOf<__Entity__Module>().toHaveProperty("close");
  });
});
