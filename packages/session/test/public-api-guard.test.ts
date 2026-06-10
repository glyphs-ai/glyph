/**
 * Compile-time public API guard for `@glyphs-ai/session`.
 *
 * WHAT this file does:
 *   Uses Vitest's `expectTypeOf<T>()` to lock the pkg's public surface
 *   at the TYPE level. Every public method on the service class, every
 *   exported error class (including the 6 runtime errors re-exported
 *   through this barrel), and every exported DTO / option shape gets a
 *   `expectTypeOf(...)` assertion below.
 *
 * WHY it is valuable:
 *   Silent renames (`spawnInteractive` → `runInteractive`), accidental
 *   method removals, DTO-field drift, and quietly dropping a runtime
 *   error from the re-export contract all break downstream pkgs at
 *   compile time — but only the downstream pkg's typecheck sees the
 *   failure, which means breakage surfaces in a sibling PR (or worse,
 *   in `dashboard`) instead of in the pkg that caused it. This guard
 *   pulls the failure forward: `pnpm --filter @glyphs-ai/session typecheck`
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

import { describe, expectTypeOf, it } from "vitest";
import {
  type AgentEntry,
  AgentNotFoundError,
  AgentResolutionFailedError,
  type BuildInteractiveLaunchSessionOpts,
  type CreateSessionOpts,
  composeSessionModule,
  type DeleteSessionOpts,
  InvalidSessionIdError,
  type LaunchCommand,
  // Re-exported from @glyphs-ai/runtime — locked here so the re-export
  // contract can't silently drop a class downstream callers catch by
  // `instanceof`.
  RuntimeDoesNotSupportRemoteError,
  RuntimeProvisionFailed,
  RuntimeRefreshFailed,
  RuntimeStateDeletionFailed,
  type Session,
  SessionError,
  SessionIdAllocationFailedError,
  type SessionModule,
  type SessionModuleOptions,
  SessionNotFoundError,
  type SessionService,
  type SessionServiceOpts,
  type SpawnInteractiveResult,
  TrustRegistrationFailed,
  UnknownRuntimeError,
} from "../src/index.js";

describe("@glyphs-ai/session public API guard", () => {
  it("exports the concrete error classes with their canonical constructor signatures", () => {
    const errs: Error[] = [
      new SessionError("boom"),
      new InvalidSessionIdError("bad-id"),
      new SessionNotFoundError("20260101-deadbeef"),
      new SessionIdAllocationFailedError(5),
      new AgentNotFoundError("public/demo"),
      new AgentNotFoundError("public/demo", new Error("upstream")),
      new AgentResolutionFailedError("public/demo"),
      new AgentResolutionFailedError("public/demo", new Error("upstream")),
      // Runtime re-exports — same constructor shapes as in @glyphs-ai/runtime.
      new UnknownRuntimeError("copilot"),
      new RuntimeRefreshFailed("copilot", "runtime-session-id", new Error("upstream")),
      new RuntimeStateDeletionFailed("copilot", "runtime-session-id", new Error("upstream")),
      new RuntimeProvisionFailed("copilot", "/workdir", new Error("upstream")),
      new RuntimeDoesNotSupportRemoteError("copilot"),
      new TrustRegistrationFailed("/cfg.json", "/workspace", new Error("upstream")),
    ];
    expectTypeOf(errs[0]!).toExtend<Error>();
  });

  it("preserves the public DTO + option shapes", () => {
    // Session wire DTO — the dashboard renders these fields and the
    // server projects them; a rename here breaks both immediately.
    expectTypeOf<Session>().toHaveProperty("id");
    expectTypeOf<Session>().toHaveProperty("workdir");
    expectTypeOf<Session>().toHaveProperty("agent");
    expectTypeOf<Session>().toHaveProperty("runtime");
    expectTypeOf<Session>().toHaveProperty("runtimeSessionId");
    expectTypeOf<Session>().toHaveProperty("createdAt");
    expectTypeOf<Session>().toHaveProperty("lastActiveAt");
    expectTypeOf<Session>().toHaveProperty("preview");
    expectTypeOf<Session>().toHaveProperty("lastLaunchMode");

    // Option bags consumed by the service surface.
    expectTypeOf<CreateSessionOpts>().toHaveProperty("agent");
    expectTypeOf<DeleteSessionOpts>().toHaveProperty("purge");
    expectTypeOf<BuildInteractiveLaunchSessionOpts>().toHaveProperty("remote");

    // Port DTO produced for spawnInteractive results.
    expectTypeOf<SpawnInteractiveResult>().toHaveProperty("launcher");

    // Catalog-side port shape consumed at create() time.
    expectTypeOf<AgentEntry>().toHaveProperty("status");

    // LaunchCommand is re-exported from @glyphs-ai/runtime so callers
    // only need one import; locking the field names here protects
    // the re-export contract.
    expectTypeOf<LaunchCommand>().toHaveProperty("cmd");
    expectTypeOf<LaunchCommand>().toHaveProperty("args");
    expectTypeOf<LaunchCommand>().toHaveProperty("cwd");
    expectTypeOf<LaunchCommand>().toHaveProperty("display");
  });

  it("preserves the SessionService class and its public method names", () => {
    expectTypeOf<SessionService>().toHaveProperty("create");
    expectTypeOf<SessionService>().toHaveProperty("list");
    expectTypeOf<SessionService>().toHaveProperty("get");
    expectTypeOf<SessionService>().toHaveProperty("delete");
    expectTypeOf<SessionService>().toHaveProperty("buildInteractiveLaunch");
    expectTypeOf<SessionService>().toHaveProperty("spawnInteractive");
  });

  it("preserves the composition surface (composeSessionModule + SessionModule + SessionModuleOptions)", () => {
    expectTypeOf(composeSessionModule).parameters.toEqualTypeOf<[SessionModuleOptions]>();
    expectTypeOf(composeSessionModule).returns.resolves.toEqualTypeOf<SessionModule>();

    expectTypeOf<SessionModule>().toHaveProperty("service");
    expectTypeOf<SessionModule>().toHaveProperty("close");

    expectTypeOf<SessionModuleOptions>().toHaveProperty("dbFile");
    expectTypeOf<SessionModuleOptions>().toHaveProperty("agentResolver");
    expectTypeOf<SessionModuleOptions>().toHaveProperty("contentSource");
    expectTypeOf<SessionModuleOptions>().toHaveProperty("runtimeRegistry");
    expectTypeOf<SessionModuleOptions>().toHaveProperty("workspaceDir");
    expectTypeOf<SessionModuleOptions>().toHaveProperty("workspaceId");

    expectTypeOf<SessionServiceOpts>().toHaveProperty("agentResolver");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("contentSource");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("runtimeRegistry");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("workspaceDir");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("workspaceId");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("db");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("spawnFn");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("logger");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("now");
    expectTypeOf<SessionServiceOpts>().toHaveProperty("randomBytes");
  });
});
