/**
 * zod schema for the `GET /api/config` wire shape. Mirrors
 * `ServerConfig` from the api `wire/` surface; parity pinned by the
 * wire-schema parity test.
 */
import { z } from "zod";

export const ServerConfigSchema = z.object({
  glyphHome: z.string(),
  currentWorkspaceId: z.string().nullable(),
  host: z.string(),
  port: z.number(),
  pathSeparator: z.string(),
  tasks: z.object({
    pollIntervalMs: z.number(),
  }),
});
