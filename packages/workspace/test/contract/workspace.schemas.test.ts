import { describe, expect, it } from "vitest";
import {
  RegisterWorkspaceRequestSchema,
  RenameWorkspaceRequestSchema,
  UnregisterWorkspaceRequestSchema,
  WorkspaceIdSchema,
  WorkspaceNameSchema,
} from "../../src/contract/workspace.schemas.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("contract scalars: WorkspaceIdSchema", () => {
  it("accepts UUIDs (any version)", () => {
    expect(WorkspaceIdSchema.safeParse(UUID).success).toBe(true);
    expect(WorkspaceIdSchema.safeParse("11111111-1111-1111-8111-111111111111").success).toBe(true);
  });

  it("rejects non-UUIDs", () => {
    expect(WorkspaceIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(WorkspaceIdSchema.safeParse("").success).toBe(false);
  });
});

describe("contract scalars: WorkspaceNameSchema", () => {
  it("accepts non-empty, in-range, no-control-char strings", () => {
    expect(WorkspaceNameSchema.safeParse("Project").success).toBe(true);
    expect(WorkspaceNameSchema.safeParse("中文 ").success).toBe(true);
    expect(WorkspaceNameSchema.safeParse("🚀").success).toBe(true);
  });

  it("rejects empty / whitespace-only", () => {
    expect(WorkspaceNameSchema.safeParse("").success).toBe(false);
    expect(WorkspaceNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects names over 64 chars", () => {
    expect(WorkspaceNameSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(WorkspaceNameSchema.safeParse("a".repeat(64)).success).toBe(true);
  });

  it("rejects control characters", () => {
    expect(WorkspaceNameSchema.safeParse("hello\u0001world").success).toBe(false);
    expect(WorkspaceNameSchema.safeParse("hello\u007Fworld").success).toBe(false);
  });
});

describe("RegisterWorkspaceRequestSchema", () => {
  const ABS = process.platform === "win32" ? "C:\\some\\path" : "/some/path";

  it("accepts a valid shape (name + optional workspaceDir)", () => {
    expect(
      RegisterWorkspaceRequestSchema.safeParse({ name: "My Project", workspaceDir: ABS }).success,
    ).toBe(true);
  });

  it("accepts an omitted workspaceDir (service defaults it)", () => {
    expect(RegisterWorkspaceRequestSchema.safeParse({ name: "My Project" }).success).toBe(true);
  });

  it("rejects an over-long name (composed from WorkspaceNameSchema)", () => {
    expect(
      RegisterWorkspaceRequestSchema.safeParse({ name: "a".repeat(65), workspaceDir: ABS }).success,
    ).toBe(false);
  });

  it("rejects an empty workspaceDir when present", () => {
    expect(RegisterWorkspaceRequestSchema.safeParse({ name: "P", workspaceDir: "" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown key (strict — id is server-minted)", () => {
    expect(
      RegisterWorkspaceRequestSchema.safeParse({ name: "P", workspaceDir: ABS, id: UUID }).success,
    ).toBe(false);
  });
});

describe("RenameWorkspaceRequestSchema", () => {
  it("accepts a valid new name", () => {
    expect(RenameWorkspaceRequestSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("rejects an empty / over-long new name (composed from WorkspaceNameSchema)", () => {
    expect(RenameWorkspaceRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(RenameWorkspaceRequestSchema.safeParse({ name: "a".repeat(65) }).success).toBe(false);
  });
});

describe("UnregisterWorkspaceRequestSchema", () => {
  it("accepts an optional boolean purge", () => {
    expect(UnregisterWorkspaceRequestSchema.safeParse({}).success).toBe(true);
    expect(UnregisterWorkspaceRequestSchema.safeParse({ purge: true }).success).toBe(true);
  });

  it("rejects a non-boolean purge", () => {
    expect(UnregisterWorkspaceRequestSchema.safeParse({ purge: "yes" }).success).toBe(false);
  });
});
