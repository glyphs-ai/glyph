import {
  AgentFrontmatterError,
  AgentNameInvalidError,
  AgentNotFoundError,
  AgentOriginConflictError,
  AgentPlanStaleError,
  CyclicDependencyError,
  FetchError,
  HasDependentsError,
  ImmutableOriginError,
  McpInvalidJsonError,
  McpNameInvalidError,
  McpNotFoundError,
  McpOriginConflictError,
  OriginParseError,
  PlanStaleError,
  SkillFrontmatterError,
  SkillNameInvalidError,
  SkillNotFoundError,
  SkillOriginConflictError,
} from "@glyphs-ai/catalog";
import {
  RuntimeHeadlessLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeRefreshFailed,
  RuntimeStateDeletionFailed,
} from "@glyphs-ai/runtime";
import { describe, expect, it } from "vitest";
import { catalogErrorPolicy } from "../../src/routes/_error-policies/catalog.js";
import { errorBody, INTERNAL_ERROR_NAMES } from "../../src/routes/_shared.js";

// These tests pin the security-critical behavior of `errorBody`: only
// glyph's own typed errors leak their `.message` to the client. Any
// other error (generic Error, FS errors, third-party library errors)
// flattens to the opaque "internal error" so host paths and stack
// traces never reach the dashboard.
//
// The catalog-policy status block below MUST instantiate REAL catalog
// errors (not `new Error(); err.name = "..."`). The policy is
// instanceof-based, so faking `err.name` will not match; every
// faked-name test must fall through to null.

/**
 * Walks `catalogErrorPolicy.statuses` like respondError does, returning
 * the first matching status or `null` if no entry matches. Used here
 * to test the policy data without coupling these cases to the full
 * respondError + Hono mount.
 */
function catalogPolicyStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  for (const [klass, status] of catalogErrorPolicy.statuses) {
    if (err instanceof klass) return status;
  }
  return null;
}

describe("errorBody", () => {
  it("exposes message + code for known typed catalog errors", () => {
    const notFound = new SkillNotFoundError("public/foo");
    expect(errorBody(notFound)).toEqual({
      error: notFound.message,
      code: "SkillNotFoundError",
    });

    const nameInvalid = new SkillNameInvalidError("bad/name", "must be kebab-case");
    expect(errorBody(nameInvalid)).toEqual({
      error: nameInvalid.message,
      code: "SkillNameInvalidError",
    });
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
      "RuntimeRefreshFailed",
      "RuntimeStateDeletionFailed",
      "UnknownRuntimeError",
      "TrustRegistrationFailed",
      // terminal
      "NoTerminalFoundError",
      "TerminalSpawnFailedError",
      "UnsupportedPlatformError",
      // catalog (real per-entity class names; aliases like
      // "NotFound"/"NameInvalid"/"FrontmatterError" are intentionally
      // absent — the catalog never emits instances with those names.
      "AgentFrontmatterError",
      "SkillFrontmatterError",
      "FetchError",
      "HasDependentsError",
      "ImmutableOriginError",
      "McpInvalidJsonError",
      "McpNameInvalidError",
      "SkillNameInvalidError",
      "AgentNameInvalidError",
      "SkillNotFoundError",
      "McpNotFoundError",
      "SkillOriginConflictError",
      "AgentOriginConflictError",
      "McpOriginConflictError",
      "OriginParseError",
      "PlanStaleError",
      "AgentPlanStaleError",
      "CyclicDependencyError",
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
      // workspace
      "InputValidationError",
      "RegistryError",
      "WorkspaceError",
      "WorkspaceIdConflictError",
      "WorkspaceIdInvalidError",
      "WorkspaceNameInvalidError",
      "WorkspaceNotRegisteredError",
      "WorkspacePathConflictError",
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
  // Real instances only — mapping must work against `instanceof`
  // checks against the catalog-package classes. The policy uses
  // per-class instanceof entries so adding a new typed error class
  // becomes a TypeScript-visible change (the
  // policy file's imports won't compile against a missing class).
  const cases: Array<[label: string, err: Error, status: number]> = [
    ["SkillNameInvalidError", new SkillNameInvalidError("bad", "must be kebab"), 400],
    ["AgentNameInvalidError", new AgentNameInvalidError("bad", "must be kebab"), 400],
    ["McpNameInvalidError", new McpNameInvalidError("bad", "must be kebab"), 400],
    ["SkillFrontmatterError", new SkillFrontmatterError("source", "missing version"), 400],
    ["AgentFrontmatterError", new AgentFrontmatterError("source", "missing version"), 400],
    ["McpInvalidJsonError", new McpInvalidJsonError("source", "trailing comma"), 400],
    ["OriginParseError", new OriginParseError("garbage://x", "unsupported scheme"), 400],
    ["PlanStaleError", new PlanStaleError("public/foo", "file:/x", "abc", "def"), 400],
    ["AgentPlanStaleError", new AgentPlanStaleError("public/foo", "file:/x", "abc", "def"), 400],
    [
      "CyclicDependencyError",
      new CyclicDependencyError(["file:/abs/a", "file:/abs/b", "file:/abs/a"]),
      400,
    ],

    ["SkillNotFoundError", new SkillNotFoundError("public/foo"), 404],
    ["AgentNotFoundError", new AgentNotFoundError("public/foo"), 404],
    ["McpNotFoundError", new McpNotFoundError("a/b"), 404],

    ["ImmutableOriginError", new ImmutableOriginError("public/foo", "github://x"), 405],

    [
      "HasDependentsError",
      new HasDependentsError("public/foo", [{ kind: "skill", name: "public/bar" }]),
      409,
    ],
    [
      "SkillOriginConflictError",
      new SkillOriginConflictError("public/foo", "file:/old", "file:/new"),
      409,
    ],
    [
      "AgentOriginConflictError",
      new AgentOriginConflictError("public/foo", "file:/old", "file:/new"),
      409,
    ],
    ["McpOriginConflictError", new McpOriginConflictError("a/b", "file:/old", "file:/new"), 409],
  ];

  it.each(cases)("maps real %s to %d", (_label, err, status) => {
    expect(catalogPolicyStatus(err)).toBe(status);
  });

  it("maps a real FetchError instance to 502", () => {
    // Real instances match; name-spoofed generic errors do not.
    expect(catalogPolicyStatus(new FetchError("https://example", "connect ECONNREFUSED"))).toBe(
      502,
    );
  });

  it("returns null for a fabricated FetchError name (instanceof check now)", () => {
    const e = new Error("connect ECONNREFUSED");
    e.name = "FetchError";
    expect(catalogPolicyStatus(e)).toBeNull();
  });

  it("returns null for unknown error class names", () => {
    const e = new Error("x");
    e.name = "WeirdoError";
    expect(catalogPolicyStatus(e)).toBeNull();
  });

  it("returns null for non-Error values", () => {
    expect(catalogPolicyStatus("string")).toBeNull();
    expect(catalogPolicyStatus(null)).toBeNull();
    expect(catalogPolicyStatus(undefined)).toBeNull();
  });

  it("returns null for phantom names that no real class produces", () => {
    // No class with these names appears in the statuses array, so the
    // policy cannot accept them by name spoofing.
    for (const name of [
      "CatalogError",
      "CatalogStateError",
      "CycleDetected",
      "MissingDependencies",
      "UnsupportedCatalogVersionError",
    ]) {
      const e = new Error("x");
      e.name = name;
      expect(catalogPolicyStatus(e)).toBeNull();
    }
  });

  it("rejects alias names", () => {
    // The policy is instanceof-based, so alias names can't match by
    // construction.
    for (const alias of [
      "NotFound",
      "NameInvalid",
      "FrontmatterError",
      "OriginConflictError",
      "InvalidMcpJsonError",
      "HasDependents",
    ]) {
      const e = new Error("x");
      e.name = alias;
      expect(catalogPolicyStatus(e)).toBeNull();
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
      name: "RuntimeRefreshFailed",
      err: new RuntimeRefreshFailed("copilot", "20260509-deadbeef-cafef00d-aaaa-bbbb", fsCause),
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
    const r = new RuntimeRefreshFailed("copilot", "sid-123", fsCause);
    expect(r.kind).toBe("copilot");
    expect(r.sessionId).toBe("sid-123");

    const p = new RuntimeProvisionFailed("copilot", "/abs/wd", fsCause);
    expect(p.workdir).toBe("/abs/wd");

    const d = new RuntimeHeadlessLaunchFailed("copilot", "/abs/td", fsCause);
    expect(d.workdir).toBe("/abs/td");
  });
});
