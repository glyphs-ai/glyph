/**
 * Compile-time public API guard for `@glyphs-ai/workspace`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the pkg's public surface
 *   at the TYPE level. Every public method on the service class, every
 *   exported error class, every exported DTO / layout shape, and every
 *   exported layout helper / constant gets a `expectTypeOf(...)`
 *   assertion below.
 *
 * WHY it is valuable:
 *   Silent renames (`register` → `addWorkspace`), accidental method
 *   removals, DTO-field drift, and dropping a path-layout helper that
 *   server/api re-use all break downstream pkgs at compile time — but
 *   only the downstream pkg's typecheck sees the failure, which means
 *   breakage surfaces in a sibling PR (or worse, in `dashboard`)
 *   instead of in the pkg that caused it. This guard pulls the
 *   failure forward: `pnpm --filter @glyphs-ai/workspace typecheck`
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
 * for a fully-populated version locking 25+ methods and 19 error
 * classes on a real BC.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  composeWorkspaceModule,
  type GLOBAL_DB_FILE,
  globalDbPath,
  InputValidationError,
  type RegisterWorkspaceOpts,
  type RegisterWorkspaceResult,
  RegistryError,
  type RenameWorkspaceOpts,
  type UnregisterWorkspaceOpts,
  type WORKSPACES_PARENT_SUBDIR,
  type Workspace,
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceIdInvalidError,
  type WorkspaceLayout,
  type WorkspaceModule,
  type WorkspaceModuleOptions,
  WorkspaceNameInvalidError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
  type WorkspaceService,
  type WorkspaceServiceOpts,
  workspaceLayout,
  workspacesParentDir,
} from "../src/index.js";

describe("@glyphs-ai/workspace public API guard", () => {
  it("exports the concrete error classes with their canonical constructor signatures", () => {
    const pathConflict = new WorkspacePathConflictError(
      "C:/path",
      "00000000-0000-4000-8000-000000000000",
    );
    const errs: Error[] = [
      new WorkspaceError("boom"),
      new WorkspaceError("boom", { cause: new Error("upstream") }),
      new RegistryError("boom"),
      new WorkspaceIdConflictError("00000000-0000-4000-8000-000000000000"),
      new WorkspaceIdInvalidError("bad-id"),
      new WorkspaceNameInvalidError("", "must be non-empty"),
      new WorkspaceNotRegisteredError("00000000-0000-4000-8000-000000000000"),
      pathConflict,
      // InputValidationError extends Error directly (NOT WorkspaceError) —
      // the public barrel re-exports it; lock that contract here.
      new InputValidationError("register", [{ path: ["name"], message: "required" }]),
    ];
    expectTypeOf(errs[0]!).toExtend<Error>();
    expectTypeOf(pathConflict).toHaveProperty("workspaceDir");
    expectTypeOf(pathConflict).toHaveProperty("existingWorkspaceId");
    expectTypeOf(new InputValidationError("scope", [])).toExtend<Error>();
  });

  it("preserves the public DTO + layout shapes", () => {
    // Workspace wire DTO — the dashboard renders these fields and the
    // server projects them; a rename here breaks both immediately.
    expectTypeOf<Workspace>().toHaveProperty("id");
    expectTypeOf<Workspace>().toHaveProperty("name");
    expectTypeOf<Workspace>().toHaveProperty("workspaceDir");
    expectTypeOf<Workspace>().toHaveProperty("createdAt");
    expectTypeOf<Workspace>().toHaveProperty("lastOpenedAt");

    // Conventional sub-path layout — sessions/tasks are active T0
    // workspace paths; T1 `@glyphs-ai/workflow` owns the `workflows/`
    // directory.
    expectTypeOf<WorkspaceLayout>().toHaveProperty("sessions");
    expectTypeOf<WorkspaceLayout>().toHaveProperty("tasks");
    expectTypeOf<WorkspaceLayout>().toHaveProperty("workflows");
    expect(Object.keys(workspaceLayout("workspace-root")).sort()).toEqual([
      "sessions",
      "tasks",
      "workflows",
    ]);
  });

  it("preserves the WorkspaceService class and its public method names", () => {
    expectTypeOf<WorkspaceService>().toHaveProperty("get");
    expectTypeOf<WorkspaceService>().toHaveProperty("list");
    expectTypeOf<WorkspaceService>().toHaveProperty("getLastOpened");
    expectTypeOf<WorkspaceService>().toHaveProperty("getLastOpenedId");
    expectTypeOf<WorkspaceService>().toHaveProperty("register");
    expectTypeOf<WorkspaceService>().toHaveProperty("open");
    expectTypeOf<WorkspaceService>().toHaveProperty("rename");
    expectTypeOf<WorkspaceService>().toHaveProperty("unregister");

    expectTypeOf<WorkspaceServiceOpts>().toHaveProperty("repo");
    expectTypeOf<WorkspaceServiceOpts>().toHaveProperty("logger");
    expectTypeOf<WorkspaceService["get"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<WorkspaceService["get"]>().returns.resolves.toEqualTypeOf<Workspace | null>();
    expectTypeOf<WorkspaceService["register"]>().parameters.toEqualTypeOf<
      [RegisterWorkspaceOpts]
    >();
    expectTypeOf<
      WorkspaceService["register"]
    >().returns.resolves.toEqualTypeOf<RegisterWorkspaceResult>();
    expectTypeOf<WorkspaceService["rename"]>().parameters.toEqualTypeOf<
      [string, RenameWorkspaceOpts]
    >();
    expectTypeOf<WorkspaceService["unregister"]>().parameters.toEqualTypeOf<
      [string, UnregisterWorkspaceOpts?]
    >();
  });

  it("preserves the exported layout helpers + filename constants", () => {
    expectTypeOf(workspaceLayout).toBeFunction();
    expectTypeOf(workspacesParentDir).toBeFunction();
    expectTypeOf(globalDbPath).toBeFunction();
    // String-literal subtypes; assert assignability to `string` rather
    // than exact equality so renaming the literal value remains an
    // internal change while the public type stays string-shaped.
    expectTypeOf<typeof GLOBAL_DB_FILE>().toExtend<string>();
    expectTypeOf<typeof WORKSPACES_PARENT_SUBDIR>().toExtend<string>();
  });

  it("preserves the composition surface (composeWorkspaceModule + WorkspaceModule + WorkspaceModuleOptions)", () => {
    expectTypeOf(composeWorkspaceModule).parameters.toEqualTypeOf<[WorkspaceModuleOptions]>();
    expectTypeOf(composeWorkspaceModule).returns.resolves.toEqualTypeOf<WorkspaceModule>();

    expectTypeOf<WorkspaceModule>().toHaveProperty("service");
    expectTypeOf<WorkspaceModule>().toHaveProperty("close");

    expectTypeOf<WorkspaceModuleOptions>().toHaveProperty("dbFile");
  });
});
