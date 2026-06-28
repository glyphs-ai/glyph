/**
 * Error hierarchy for `@glyphs-ai/workspace` registry failures. Every
 * class extends `WorkspaceError`, so callers can `instanceof
 * WorkspaceError` for a coarse "is this a workspace registry error?"
 * check; subclasses carry typed context (the offending id /
 * workspaceDir).
 *
 * These are PRECONDITION / conflict errors — the registry's state
 * forbids the operation. Input *format* validation is NOT here: it
 * lives as zod schemas in `contract/workspace.schemas.ts` and surfaces as
 * `ZodError` from the service's `Schema.parse(...)` calls, which the
 * api layer maps to a 400 `ValidationError` envelope.
 *
 * `RegistryError` is a sub-base for errors originating in the registry
 * table itself (id / workspaceDir conflicts, missing rows, raw
 * constraint violations). All subclasses are exported so the HTTP layer
 * can map them to status codes downstream.
 */
export class WorkspaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceError";
  }
}

/** Base for all registry-related errors. */
export class RegistryError extends WorkspaceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RegistryError";
  }
}

export class WorkspaceIdConflictError extends RegistryError {
  override readonly name = "WorkspaceIdConflictError";

  constructor(public readonly workspaceId: string) {
    super(`a workspace with id "${workspaceId}" is already registered`);
  }
}

export class WorkspacePathConflictError extends RegistryError {
  override readonly name = "WorkspacePathConflictError";

  constructor(
    public readonly workspaceDir: string,
    public readonly existingWorkspaceId: string,
  ) {
    super(
      `workspaceDir "${workspaceDir}" is already registered as workspace id "${existingWorkspaceId}"`,
    );
  }
}

export class WorkspaceNotRegisteredError extends RegistryError {
  override readonly name = "WorkspaceNotRegisteredError";

  constructor(public readonly workspaceId: string) {
    super(`no workspace with id "${workspaceId}" is registered`);
  }
}
