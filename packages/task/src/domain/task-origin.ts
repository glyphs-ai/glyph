/**
 * Who launched this task. An open string discriminator, not a closed enum:
 * `"standalone"` is a direct user dispatch (CLI / dashboard / MCP); integration
 * handlers supply their own origin (`"schedule"`, `"workflow"`) paired with a
 * typed `originId`. The closed catalog of known origins lives at the wire
 * boundary (`@glyphs-ai/api`), not here. Kept unbranded so it stays a plain
 * `string` at every entity, mapper, and request boundary.
 */
import { z } from "zod";

export const TaskOriginSchema = z.string().min(1);
export type TaskOrigin = z.infer<typeof TaskOriginSchema>;
