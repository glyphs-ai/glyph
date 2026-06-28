/**
 * Wire-only zod schemas used by `routes/workspaces.ts` that don't
 * appear in any workspace use-case request/response. They live here
 * because they're shaped by HTTP routing concerns (path params, the
 * `/current` envelope) rather than by the workspace domain.
 *
 *   - `WorkspacePathParamsSchema` — `:id` URL parameter validator
 *   - `CurrentWorkspaceResponseSchema` — `{ id }` envelope for the
 *     `/current` GET/PUT pair (mirrors the cli/dashboard expectations)
 *   - `SetCurrentWorkspaceRequestSchema` — body for `PUT /current`
 *   - `WorkspaceWireSchema` — wire DTO returned by `GET /` and
 *     `GET /:id`; equivalent to a non-null `GetWorkspaceResponse` but
 *     re-declared here so the route file can hand the schema to
 *     `@hono/zod-openapi` without depending on use-case internals.
 */

import { WorkspaceIdSchema, WorkspaceNameSchema } from "@glyphs-ai/workspace";
import { z } from "zod";

export const WorkspacePathParamsSchema = z.object({
  id: z.string(),
});

export const SetCurrentWorkspaceRequestSchema = z.object({ id: z.string().min(1) }).strict();

export const CurrentWorkspaceResponseSchema = z.object({
  id: z.string().nullable(),
});

export const WorkspaceWireSchema = z.object({
  id: WorkspaceIdSchema,
  name: WorkspaceNameSchema,
  workspaceDir: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});
