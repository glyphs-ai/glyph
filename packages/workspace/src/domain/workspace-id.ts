import { z } from "zod";

/**
 * RFC-4122 workspace UUID, branded so raw strings cannot cross
 * boundaries that require a validated workspace id.
 */
export const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid UUID")
  .brand("WorkspaceId");

export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
