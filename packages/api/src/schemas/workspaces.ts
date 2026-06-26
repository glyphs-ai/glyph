/**
 * zod schemas for the `/api/workspaces` wire shapes. Mirrors the DTOs in
 * the api `wire/` surface (`wire/routes/workspaces.ts`); parity pinned by
 * the wire-schema parity test.
 */
import { z } from "zod";

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  workspaceDir: z.string(),
  lastOpenedAt: z.string(),
});

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string(),
  workspaceDir: z.string().optional(),
});

export const WorkspaceWarmingResponseSchema = z.object({
  state: z.literal("warming"),
  workspaceId: z.string(),
});

export const WorkspaceLoadFailedResponseSchema = z.object({
  error: z.string(),
  code: z.literal("WorkspaceLoadError"),
});

export const SetCurrentWorkspaceRequestSchema = z.object({
  id: z.string(),
});

export const PatchWorkspaceRequestSchema = z.object({
  name: z.string().optional(),
});

export const CurrentWorkspaceResponseSchema = z.object({
  id: z.string().nullable(),
});

export const WorkspacePathParamsSchema = z.object({
  id: z.string(),
});
