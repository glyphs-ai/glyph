/**
 * zod schemas for the `/api/workspaces/:id/sessions` wire shapes. Single
 * source of truth for the server's OpenAPI projection and the inferred
 * wire types (re-exported below via `z.infer`), plus the re-exported
 * `Session` domain type.
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

export const CreateSessionRequestSchema = z
  .object({
    agent: z.string().refine((s) => s.trim().length > 0, "agent is required (string)"),
    runtime: z.string().optional(),
  })
  .strict();

export const SessionDeleteQuerySchema = z.object({
  purge: z.literal("1").optional(),
});

export const SpawnSessionRequestSchema = z.object({ remote: z.boolean().optional() }).strict();

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

// Inferred wire types — single source of truth is the schemas above.
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SessionDeleteQuery = z.infer<typeof SessionDeleteQuerySchema>;
export type SpawnSessionRequest = z.infer<typeof SpawnSessionRequestSchema>;
export type SpawnSessionResponse = z.infer<typeof SpawnSessionResponseSchema>;
export type SessionPathParams = z.infer<typeof SessionPathParamsSchema>;
