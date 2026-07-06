import { z } from "zod";

/**
 * Where a catalog entry was installed from. Open string discriminator shared by
 * agents, skills, and MCPs: the direct-install surface plus any integration
 * that supplies its own origin. Mirrors `@glyphs-ai/workflow`'s
 * `WorkflowOriginSchema` and is kept unbranded so it stays a plain `string` at
 * every write-path request boundary — catalog owns its own value object rather
 * than reaching across packages for one.
 */
export const RegistryOriginSchema = z.string().min(1);
export type RegistryOrigin = z.infer<typeof RegistryOriginSchema>;
