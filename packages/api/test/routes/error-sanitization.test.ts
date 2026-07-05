import { describe, expect, it } from "vitest";
import { catalogErrorPolicy } from "../../src/_error-policies/catalog.js";
import { errorBody, INTERNAL_ERROR_NAMES } from "../../src/_http-errors.js";

// These tests pin the security-critical behavior of `errorBody`: only
// glyph's own typed errors leak their `.message` to the client. Any
// other error (generic Error, FS errors, third-party library errors)
// flattens to the opaque "internal error" so host paths and stack
// traces never reach the dashboard.

/**
 * Walks `catalogErrorPolicy.codeStatuses` like respondError does, returning
 * the first matching status or `null` if no entry matches. Used here
 * to test the policy data without coupling these cases to the full
 * respondError + Hono mount.
 */
function catalogPolicyStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = err.code;
  if (typeof code !== "string") return null;
  for (const [entryCode, status] of catalogErrorPolicy.codeStatuses ?? []) {
    if (code === entryCode) return status;
  }
  return null;
}

function catalogRouteError(code: string): unknown {
  return { tag: "CatalogRouteError", code, message: `canonical message for ${code}` };
}

describe("errorBody", () => {
  it("keeps catalog DU route errors out of the global class allow-list", () => {
    expect(errorBody(catalogRouteError("SkillNotFound"))).toEqual({ error: "internal error" });
  });

  it("flattens generic Error to 'internal error' (no leak)", () => {
    expect(errorBody(new Error("EACCES: permission denied, open '/etc/shadow'"))).toEqual({
      error: "internal error",
    });
  });

  it("flattens unknown error class to 'internal error'", () => {
    class FromSomeLib extends Error {
      constructor() {
        super("library secret message with internal path /var/lib/secret");
        this.name = "SomeLibError";
      }
    }
    expect(errorBody(new FromSomeLib())).toEqual({ error: "internal error" });
  });

  it("flattens non-Error throwables (string, object) to 'internal error'", () => {
    expect(errorBody("a string thrown by accident")).toEqual({ error: "internal error" });
    expect(errorBody({ secret: "shhh" })).toEqual({ error: "internal error" });
    expect(errorBody(null)).toEqual({ error: "internal error" });
    expect(errorBody(undefined)).toEqual({ error: "internal error" });
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
      // SAFE_ERROR_NAMES since `respondWorkspaceError` writes the body
      // directly from the DU `type` discriminator and doesn't go
      // through `errorBody`).
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
      expect(errorBody(err)).toEqual({
        error: `canonical message for ${name}`,
        code: name,
      });
    }
  });

  it("keeps documented internal exported errors opaque", () => {
    for (const name of INTERNAL_ERROR_NAMES) {
      const err = new Error(`sensitive diagnostic for ${name}: C:\\Users\\me\\.glyph`);
      err.name = name;
      expect(errorBody(err)).toEqual({ error: "internal error" });
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
    ["DatabaseUnavailable", catalogRouteError("DatabaseUnavailable"), 500],
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
