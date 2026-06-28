/**
 * zod schemas for `@glyphs-ai/workspace`. Plain `zod` (no hono) — the
 * single source of truth for the server's OpenAPI projection (attached in
 * `@glyphs-ai/api`'s route module via `.openapi(...)`), the inferred
 * types in `./workspace.types.ts`, and the runtime validation `WorkspaceService`
 * performs on its own inputs.
 *
 * Each write operation has ONE input schema, shared by the HTTP route
 * and the service method — there is no separate wire-DTO vs service-opts
 * shape. The service owns each operation end to end (id minting, default
 * directory), so the request body and the service input are identical.
 */
import { z } from "zod";

// ─── Reusable scalar schemas ─────────────────────────────────

/** RFC-4122 UUID. Accept any version; we mint v4 but external sources may differ. */
export const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid UUID");

/** Non-empty after trim; ≤ 64 chars; no control chars. */
export const WorkspaceNameSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "must be non-empty after trim")
  .refine((s) => s.length <= 64, "must be at most 64 characters")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control chars in user input is the point.
  .refine((s) => !/[\u0000-\u001F\u007F]/.test(s), "must not contain control characters");

// ─── Operation input schemas (shared by route + service) ─────

/**
 * `register` input. `name` is required; `workspaceDir` is optional — when
 * omitted the service mints `<defaultWorkspaceParent>/<uuid>/`. The `id`
 * is server-minted inside the service, never supplied by the caller.
 */
export const RegisterWorkspaceRequestSchema = z
  .object({
    name: WorkspaceNameSchema,
    workspaceDir: z
      .string()
      .refine((s) => s.trim().length > 0, "workspaceDir, when present, must be a non-empty string")
      .optional(),
  })
  .strict();

/** `rename` input — the workspace's new display name. */
export const RenameWorkspaceRequestSchema = z.object({ name: WorkspaceNameSchema }).strict();

/** `unregister` input — `purge` also deletes glyph-owned subdirs. */
export const UnregisterWorkspaceRequestSchema = z.object({ purge: z.boolean().optional() });

/** `setCurrent` input — the workspace id to mark just-opened. */
export const SetCurrentWorkspaceRequestSchema = z.object({ id: z.string().min(1) }).strict();

// ─── Response / projection schemas ───────────────────────────

/** The workspace wire DTO — the registry row projected for transport. */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  workspaceDir: z.string(),
  lastOpenedAt: z.string(),
});

export const WorkspaceWarmingResponseSchema = z.object({
  state: z.literal("warming"),
  workspaceId: z.string(),
});

export const WorkspaceLoadFailedResponseSchema = z.object({
  error: z.string(),
  code: z.literal("WorkspaceLoadError"),
});

export const CurrentWorkspaceResponseSchema = z.object({
  id: z.string().nullable(),
});

export const WorkspacePathParamsSchema = z.object({
  id: z.string(),
});
