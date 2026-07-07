import { z } from "zod";

/**
 * The agent that drives a workflow: carried on the workflow header and minted
 * into the initial coordinator node. Branded so write-path requests can't
 * silently swap it for an arbitrary string. The workflow layer treats it as an
 * opaque agent reference it forwards to the runtime port — workflow never
 * depends on `@glyphs-ai/catalog`, so it owns this value object rather than
 * reusing catalog's `AgentFqnSchema`.
 */
export const CoordinatorAgentSchema = z.string().min(1).brand<"CoordinatorAgent">();
export type CoordinatorAgent = z.infer<typeof CoordinatorAgentSchema>;
