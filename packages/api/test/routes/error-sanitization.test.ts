import { describe, expect, it } from "vitest";
import { catalogErrorPolicy } from "../../src/_error-policies/catalog.js";
import { INTERNAL_ERROR_NAMES, readErrorCode, resolveProblem } from "../../src/_http-errors.js";

// These tests pin the security-critical behavior of the error seam: only
// glyph's own typed errors (class `name` in `SAFE_ERROR_NAMES`) leak their
// `.message` to the client as the Problem `detail`. Any other error
// (generic Error, FS errors, third-party library errors) flattens to the
// opaque `"internal error"` detail with an `"InternalError"` code so host
// paths and stack traces never reach the dashboard.
//
// `resolveProblem(err, {}, …)` is exercised with an EMPTY table so only the
// SAFE / INTERNAL / opaque allow-list decides the outcome — the domain
// tables (which DO map specific codes) are tested separately per route.

const OPTS = { route: "test", defaultStatus: 500 } as const;

/**
 * Project `err` through the error seam with NO domain table and return the
 * wire-visible `{ detail, code }`. Mirrors what a route's catch block emits
 * for an error its table doesn't recognise.
 */
function sanitize(err: unknown): { detail: string; code: string } {
  const { problem } = resolveProblem(err, {}, OPTS);
  return { detail: problem.detail, code: problem.code };
}

const OPAQUE = { detail: "internal error", code: "InternalError" } as const;

/**
 * Looks up `catalogErrorPolicy[code].status` like `respondError` does,
 * returning the mapped status or `null` if no entry matches. Used here to
 * test the policy data without coupling these cases to the full
 * `respondError` + Hono mount.
 */
function catalogPolicyStatus(err: unknown): number | null {
  const code = readErrorCode(err);
  if (code === undefined) return null;
  return catalogErrorPolicy[code]?.status ?? null;
}

function catalogRouteError(code: string): unknown {
  return { tag: "CatalogRouteError", code, message: `canonical message for ${code}` };
}

describe("error sanitization", () => {
  it("keeps catalog DU route errors out of the global class allow-list", () => {
    // A `{ tag, code, message }` carrier is not an `Error` instance, so with
    // no catalog table in scope it stays opaque — the catalog table (tested
    // below) is what maps these codes on the real route.
    expect(sanitize(catalogRouteError("SkillNotFound"))).toEqual(OPAQUE);
  });

  it("flattens generic Error to 'internal error' (no leak)", () => {
    expect(sanitize(new Error("EACCES: permission denied, open '/etc/shadow'"))).toEqual(OPAQUE);
  });

  it("flattens unknown error class to 'internal error'", () => {
    class FromSomeLib extends Error {
      constructor() {
        super("library secret message with internal path /var/lib/secret");
        this.name = "SomeLibError";
      }
    }
    expect(sanitize(new FromSomeLib())).toEqual(OPAQUE);
  });

  it("flattens non-Error throwables (string, object) to 'internal error'", () => {
    expect(sanitize("a string thrown by accident")).toEqual(OPAQUE);
    expect(sanitize({ secret: "shhh" })).toEqual(OPAQUE);
    expect(sanitize(null)).toEqual(OPAQUE);
    expect(sanitize(undefined)).toEqual(OPAQUE);
  });

  it("handles all known safe error names across packages", () => {
    const safeNames = [
      // session
      "AgentNotFoundError",
      "InvalidSessionIdError",
      "SessionIdAllocationFailedError",
      "SessionNotFoundError",
      "SessionError",
      // terminal
      "NoTerminalFoundError",
      "TerminalSpawnFailedError",
      "UnsupportedPlatformError",
      // schedule
      "InvalidCronExprError",
      "InvalidJsonPathError",
      "InvalidScheduleIdError",
      "InvalidTimezoneError",
      "ScheduleEnabledError",
      "ScheduleError",
      "ScheduleHasInFlightError",
      "ScheduleNotFoundError",
      // workspace (api owns WorkspaceLoadError + WorkspaceHasLiveTasksError;
      // the workspace pkg returns DU values for the rest — they bypass
      // SAFE_ERROR_NAMES since `respondWorkspaceError` builds the Problem
      // directly from the DU `type` discriminator and doesn't go through
      // this allow-list).
      // api / workflow
      "WorkspaceHasLiveTasksError",
      "InvalidWorkflowIdError",
      "InvalidWorkflowNodeIdError",
      "EmptyParentsError",
      "MultipleSuccessorCoordsError",
      "OrphanCoordInsertError",
      "ParentStateError",
      "WorkflowAlreadyTerminalError",
      "WorkflowCoordAgentNotCapableError",
      "WorkflowCoordSpecError",
      "WorkflowDagInvariantError",
      "WorkflowError",
      "WorkflowHumanSpecError",
      "WorkflowNodeKindShapeError",
      "WorkflowNodeNotFoundError",
      "WorkflowNodeNotMutableError",
      "WorkflowNodeSpecError",
      "WorkflowNotFoundError",
      "WorkflowSubgraphCyclicError",
      "WorkflowSubgraphEmptyError",
      "WorkflowSubgraphMultipleCoordTempsError",
      "WorkflowSubgraphNodeRefUnresolvedError",
      "WorkflowSubgraphTempIdInvalidError",
      "WorkflowSubgraphTempParentlessError",
      "WorkflowWorkerSpecError",
    ];
    for (const name of safeNames) {
      const err = new Error(`canonical message for ${name}`);
      err.name = name;
      expect(sanitize(err)).toEqual({
        detail: `canonical message for ${name}`,
        code: name,
      });
    }
  });

  it("keeps documented internal exported errors opaque", () => {
    for (const name of INTERNAL_ERROR_NAMES) {
      const err = new Error(`sensitive diagnostic for ${name}: C:\\Users\\me\\.glyph`);
      err.name = name;
      expect(sanitize(err)).toEqual(OPAQUE);
    }
  });
});

describe("catalogErrorPolicy mapping", () => {
  const cases: Array<[label: string, err: unknown, status: number]> = [
    ["OriginInvalid", catalogRouteError("OriginInvalid"), 400],
    ["ManifestInvalid", catalogRouteError("ManifestInvalid"), 400],

    ["SkillNotFound", catalogRouteError("SkillNotFound"), 404],
    ["AgentNotFound", catalogRouteError("AgentNotFound"), 404],
    ["McpNotFound", catalogRouteError("McpNotFound"), 404],

    ["SkillOriginConflict", catalogRouteError("SkillOriginConflict"), 409],
    ["AgentOriginConflict", catalogRouteError("AgentOriginConflict"), 409],
    ["McpOriginConflict", catalogRouteError("McpOriginConflict"), 409],

    ["SourceUnavailable", catalogRouteError("SourceUnavailable"), 502],
    ["DatabaseUnavailable", catalogRouteError("DatabaseUnavailable"), 503],
  ];

  it.each(cases)("maps catalog DU code %s to %d", (_label, err, status) => {
    expect(catalogPolicyStatus(err)).toBe(status);
  });

  it("returns null for unknown DU codes", () => {
    expect(catalogPolicyStatus(catalogRouteError("WeirdoError"))).toBeNull();
  });

  it("returns null for non-coded values", () => {
    expect(catalogPolicyStatus(new Error("x"))).toBeNull();
    expect(catalogPolicyStatus("string")).toBeNull();
    expect(catalogPolicyStatus(null)).toBeNull();
    expect(catalogPolicyStatus(undefined)).toBeNull();
  });

  it("rejects removed catalog class and alias names", () => {
    for (const name of [
      "CatalogError",
      "FetchError",
      "AgentNotFoundError",
      "NotFound",
      "OriginConflictError",
    ]) {
      expect(catalogPolicyStatus(catalogRouteError(name))).toBeNull();
    }
  });
});
