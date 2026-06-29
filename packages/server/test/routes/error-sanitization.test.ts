import { catalogErrorPolicy } from "@glyphs-ai/api";
import {
  RuntimeHeadlessLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeReadMetadataFailed,
  RuntimeStateDeletionFailed,
} from "@glyphs-ai/runtime";
import { describe, expect, it } from "vitest";
import { errorBody, INTERNAL_ERROR_NAMES } from "../../src/routes/_shared.js";

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

  it("handles all session/runtime/terminal known names", () => {
    const safeNames = [
      // session
      "AgentNotFoundError",
      "InvalidSessionIdError",
      "SessionIdAllocationFailedError",
      "SessionNotFoundError",
      "SessionError",
      // runtime
      "InvalidMcpJson",
      "RuntimeHeadlessLaunchFailed",
      "RuntimeProvisionFailed",
      "RuntimeReadActivityInvalidArgs",
      "RuntimeReadMetadataFailed",
      "RuntimeStateDeletionFailed",
      "UnknownRuntimeError",
      "TrustRegistrationFailed",
      // terminal
      "NoTerminalFoundError",
      "TerminalSpawnFailedError",
      "UnsupportedPlatformError",
      // task
      "CorruptedTaskError",
      "DispatchKernelEnvCollisionError",
      "EntryNotReadyError",
      "InvalidTaskIdError",
      "InvalidTransition",
      "ManagerShuttingDownError",
      "RuntimeDoesNotSupportTasksError",
      "TaskError",
      "TaskIdAllocationFailedError",
      "TaskNotFoundError",
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
      "TaskScheduleTargetError",
      "WorkspaceHasLiveTasksError",
      "EmptyParentsError",
      "InvalidWorkflowIdError",
      "InvalidWorkflowNodeIdError",
      "MultipleSuccessorCoordsError",
      "OrphanCoordInsertError",
      "ParentStateError",
      "WorkflowAlreadyTerminalError",
      "WorkflowCoordAgentNotCapableError",
      "WorkflowCoordSpecError",
      "WorkflowDagInvariantError",
      "WorkflowEdgeCycleError",
      "WorkflowEdgeNotFoundError",
      "WorkflowError",
      "WorkflowHumanSpecError",
      "WorkflowNodeKindShapeError",
      "WorkflowNodeNotFoundError",
      "WorkflowNodeNotMutableError",
      "WorkflowNodeSpecError",
      "WorkflowNotFoundError",
      "WorkflowRemoveEdgeOrphansChildError",
      "WorkflowRemoveNodeOrphansChildError",
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

// Pin the runtime error contract: every Runtime*Failed `.message` (the
// piece that lands in the JSON `error` field) must contain the runtime
// kind ONLY — no on-disk paths, no caller-controlled identifiers
// (sessionId / workdir), no underlying `cause.message` (which is
// typically a Node `fs` error like `EACCES: permission denied,
// open '/etc/...'`). The full diagnostic stays accessible via instance
// fields + `cause` for server-side `console.error` logging.
describe("RuntimeXxxFailed message sanitization", () => {
  const fsCause = Object.assign(new Error("EACCES: permission denied, open '/etc/shadow'"), {
    code: "EACCES",
  });

  const cases: Array<{ name: string; err: Error; forbidden: string[] }> = [
    {
      name: "RuntimeReadMetadataFailed",
      err: new RuntimeReadMetadataFailed(
        "copilot",
        "20260509-deadbeef-cafef00d-aaaa-bbbb",
        fsCause,
      ),
      forbidden: [
        "20260509-deadbeef-cafef00d-aaaa-bbbb",
        "EACCES",
        "/etc/shadow",
        "permission denied",
      ],
    },
    {
      name: "RuntimeStateDeletionFailed",
      err: new RuntimeStateDeletionFailed(
        "copilot",
        "20260509-deadbeef-cafef00d-aaaa-bbbb",
        fsCause,
      ),
      forbidden: [
        "20260509-deadbeef-cafef00d-aaaa-bbbb",
        "EACCES",
        "/etc/shadow",
        "permission denied",
      ],
    },
    {
      name: "RuntimeProvisionFailed",
      err: new RuntimeProvisionFailed(
        "copilot",
        "C:\\Users\\langcheng\\.glyph\\workspaces\\foo",
        fsCause,
      ),
      forbidden: [
        "C:\\Users\\langcheng",
        ".glyph\\workspaces",
        "EACCES",
        "/etc/shadow",
        "permission denied",
      ],
    },
    {
      name: "RuntimeHeadlessLaunchFailed",
      err: new RuntimeHeadlessLaunchFailed(
        "copilot",
        "C:\\Users\\langcheng\\.glyph\\workspaces\\foo\\tasks\\20260509-cafef00d",
        fsCause,
      ),
      forbidden: [
        "C:\\Users\\langcheng",
        "20260509-cafef00d",
        "EACCES",
        "/etc/shadow",
        "permission denied",
      ],
    },
  ];

  it.each(cases)("$name body contains kind only", ({ name, err, forbidden }) => {
    const body = errorBody(err);
    expect(body.code).toBe(name);
    expect(body.error).toContain("copilot");
    for (const banned of forbidden) {
      expect(body.error).not.toContain(banned);
    }
    // Sanity: the typed instance still preserves the full diagnostic so
    // the server-side log path can recover it.
    expect(err.cause).toBe(fsCause);
  });

  it("preserves public diagnostic fields on the instance", () => {
    const r = new RuntimeReadMetadataFailed("copilot", "sid-123", fsCause);
    expect(r.kind).toBe("copilot");
    expect(r.sessionId).toBe("sid-123");

    const p = new RuntimeProvisionFailed("copilot", "/abs/wd", fsCause);
    expect(p.workdir).toBe("/abs/wd");

    const d = new RuntimeHeadlessLaunchFailed("copilot", "/abs/td", fsCause);
    expect(d.workdir).toBe("/abs/td");
  });
});
