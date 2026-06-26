/**
 * zod schema for the `GET /api/health` wire shape. Single source of
 * truth for the OpenAPI projection in `@glyphs-ai/server`; structurally
 * mirrors `HealthResponse` from the api `wire/` surface (parity is pinned
 * by `packages/api/test/wire-schema-parity.test.ts`).
 *
 * Plain `zod` only — no `hono` / `@hono/zod-openapi` imports. Schemas are
 * transport-agnostic so future embedded / MCP / CLI-direct consumers can
 * reuse them without an HTTP round-trip.
 */
import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  name: z.string(),
  version: z.string(),
  startedAt: z.string(),
  uptimeSec: z.number(),
  serverNow: z.string(),
});
