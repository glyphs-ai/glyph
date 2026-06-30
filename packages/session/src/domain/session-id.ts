import { z } from "zod";

/**
 * Canonical session id: `YYYYMMDD-xxxxxxxx` (local-date prefix + 8 hex
 * chars = 4 random bytes). Branded so raw strings cannot cross
 * boundaries that require a validated session id. The id is minted in
 * the application layer (`generateSessionId` in `create-session.ts`);
 * this module owns only the format + brand.
 */
export const SessionIdSchema = z
  .string()
  .regex(/^\d{8}-[0-9a-f]{8}$/, "must be YYYYMMDD-xxxxxxxx")
  .brand("SessionId");

export type SessionId = z.infer<typeof SessionIdSchema>;
