import { z } from "zod";

/**
 * Who launched this workflow. Open string discriminator: `standalone` is the
 * direct user surface, while integrations provide their own origin + originId.
 */
export const WorkflowOriginSchema = z.string().min(1);
export type WorkflowOrigin = z.infer<typeof WorkflowOriginSchema>;
