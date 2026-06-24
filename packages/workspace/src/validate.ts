import path from "node:path";
import { z } from "zod";
import {
  WorkspaceError,
  WorkspaceIdInvalidError,
  WorkspaceNameInvalidError,
  WorkspacePathInvalidError,
} from "./errors.js";

/**
 * Validation helpers for workspace inputs.
 *
 * Plain functions that validate raw input strings against the
 * API-contract rules. `WorkspaceService` calls them at its boundary;
 * the repository trusts whatever the service hands it.
 */

/** RFC-4122 UUID. Accept any version; we mint v4 but external sources may differ. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_DISPLAY_NAME_LENGTH = 64;
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control chars in user input is the point.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export function isValidWorkspaceId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export function assertValidWorkspaceId(id: unknown): asserts id is string {
  if (!isValidWorkspaceId(id)) {
    throw new WorkspaceIdInvalidError(typeof id === "string" ? id : String(id));
  }
}

export function assertValidWorkspaceName(name: unknown): asserts name is string {
  if (typeof name !== "string") {
    throw new WorkspaceNameInvalidError(String(name), "must be a string");
  }
  if (name.trim().length === 0) {
    throw new WorkspaceNameInvalidError(name, "must be non-empty after trim");
  }
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new WorkspaceNameInvalidError(
      name,
      `must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_RE.test(name)) {
    throw new WorkspaceNameInvalidError(name, "must not contain control characters");
  }
}

export function isValidWorkspaceName(name: unknown): name is string {
  try {
    assertValidWorkspaceName(name);
    return true;
  } catch {
    return false;
  }
}

/** Resolve to absolute. Throws on empty / non-string / relative paths. */
export function normalizeWorkspaceDir(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkspacePathInvalidError(value, "must be a non-empty string");
  }
  if (!path.isAbsolute(value)) {
    throw new WorkspacePathInvalidError(value, "must be an absolute path");
  }
  return path.resolve(value);
}

// ─── Zod schema (presence + types; plus workspaceDir-must-be-absolute) ──

export const RegisterWorkspaceOptsSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceDir: z.string().min(1, "workspaceDir cannot be empty"),
});

/**
 * Thrown by `WorkspaceService.register` when opts fail the zod
 * shape check (presence + types). Extends `WorkspaceError` so an
 * `instanceof WorkspaceError` filter catches it alongside the typed
 * domain errors. The other writes (`open`, `rename`, `unregister`)
 * bypass zod and instead throw the typed `WorkspaceError` subclasses
 * via the `assertValid*` helpers.
 */
export class InputValidationError extends WorkspaceError {
  override readonly name = "InputValidationError";

  constructor(scope: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
    super(
      `${scope} validation failed: ${issues
        .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
}
