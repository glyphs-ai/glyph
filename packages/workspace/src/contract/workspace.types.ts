/**
 * Inferred types for `@glyphs-ai/workspace` — each is the `z.infer` of a
 * schema in `./workspace.schemas.ts` (the single source of truth). Operation input
 * types (`RegisterWorkspaceRequest`, `RenameWorkspaceRequest`,
 * `UnregisterWorkspaceRequest`) are shared by the HTTP route and the
 * `WorkspaceService` method — there is no separate wire-vs-service shape.
 */
import type { z } from "zod";
import type {
  CurrentWorkspaceResponseSchema,
  RegisterWorkspaceRequestSchema,
  RenameWorkspaceRequestSchema,
  SetCurrentWorkspaceRequestSchema,
  UnregisterWorkspaceRequestSchema,
  WorkspaceLoadFailedResponseSchema,
  WorkspacePathParamsSchema,
  WorkspaceSchema,
  WorkspaceWarmingResponseSchema,
} from "./workspace.schemas.js";

export type RegisterWorkspaceRequest = z.infer<typeof RegisterWorkspaceRequestSchema>;
export type RenameWorkspaceRequest = z.infer<typeof RenameWorkspaceRequestSchema>;
export type UnregisterWorkspaceRequest = z.infer<typeof UnregisterWorkspaceRequestSchema>;
export type SetCurrentWorkspaceRequest = z.infer<typeof SetCurrentWorkspaceRequestSchema>;
export type CurrentWorkspaceResponse = z.infer<typeof CurrentWorkspaceResponseSchema>;
export type WorkspacePathParams = z.infer<typeof WorkspacePathParamsSchema>;
export type WorkspaceWarmingResponse = z.infer<typeof WorkspaceWarmingResponseSchema>;
export type WorkspaceLoadFailedResponse = z.infer<typeof WorkspaceLoadFailedResponseSchema>;

/**
 * Wire-shape DTO returned by `WorkspaceService` reads + writes.
 * `lastOpenedAt` is always populated (the service coalesces the nullable
 * storage column to `createdAt`).
 */
export type Workspace = z.infer<typeof WorkspaceSchema>;
