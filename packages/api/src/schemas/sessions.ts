/**
 * zod schemas for the `/api/workspaces/:id/sessions` wire shapes.
 * Mirrors the DTOs in the api `wire/` surface (`wire/routes/sessions.ts`)
 * plus the re-exported `Session` domain type; parity pinned by the
 * wire-schema parity test.
 */
import { z } from "zod";

export const SessionSchema = z.object({
  id: z.string(),
  workdir: z.string(),
  agent: z.string(),
  runtime: z.string(),
  runtimeSessionId: z.string().nullable(),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
  preview: z.string().nullable(),
  lastLaunchMode: z.enum(["local", "remote"]).nullable(),
});

export const SessionListQuerySchema = z.object({
  agent: z.string().optional(),
  createdSince: z.string().optional(),
  activeSince: z.string().optional(),
});

export const CreateSessionRequestSchema = z.object({
  agent: z.string(),
  runtime: z.string().optional(),
});

export const SessionDeleteQuerySchema = z.object({
  purge: z.literal("1").optional(),
});

export const SpawnSessionRequestSchema = z.object({
  remote: z.boolean().optional(),
});

export const SpawnSessionResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    launcher: z.string(),
    display: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    code: z.string(),
    display: z.string(),
  }),
]);

export const SessionPathParamsSchema = z.object({
  id: z.string(),
  sid: z.string(),
});
