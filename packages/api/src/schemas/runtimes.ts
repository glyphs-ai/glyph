/**
 * zod schema for the `GET /api/runtimes` wire shape. Mirrors
 * `RuntimeInfo` from the api `wire/` surface; parity pinned by the
 * wire-schema parity test.
 */
import { z } from "zod";

export const RuntimeInfoSchema = z.object({
  kind: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
});
