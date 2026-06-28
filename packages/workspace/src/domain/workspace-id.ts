import { z } from "zod";

/**
 * RFC-4122 UUID for a workspace, branded so it cannot be passed
 * accidentally where another string is expected (e.g. a session id,
 * a task id, a name).
 *
 * The brand string is the full domain name (`"WorkspaceId"`, not
 * `"Id"`) to keep it unique across packages — TS treats two brands
 * with the same string as the same type, and the only thing
 * preventing collisions is the convention "brand = pkg + concept".
 *
 * Three legal ways to construct a `WorkspaceId`:
 *   1. `WorkspaceIdSchema.parse(s)` — at adapter boundaries (HTTP
 *      route bodies, CLI args). The schema both validates the UUID
 *      shape AND tags the brand.
 *   2. `s as WorkspaceId` — at trusted source-of-truth points
 *      (immediately after `randomUUID()`, when reading a persisted
 *      row). The cast is the explicit marker "I know this value is
 *      a valid WorkspaceId without re-validating".
 *   3. Receiving an already-branded `WorkspaceId` from elsewhere in
 *      the package. No-op.
 */
export const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid UUID")
  .brand("WorkspaceId");

export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
