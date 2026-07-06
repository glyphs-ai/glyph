import { z } from "zod";

/**
 * MCP spec FQN — the aggregate's identity, `<namespace>/<short>` (e.g.
 * `azure/mcp`). Branded so a raw string can't be passed where a
 * validated fqn is required (the brand name is the package concept, kept
 * unique across packages).
 *
 * Grammar fixed by the MCP spec, not glyph's storage: ≤200 chars, no
 * whitespace, no control chars/backslashes, exactly one `/`, neither
 * segment empty or `.`/`..`. The schema is the single source of truth;
 * adapter boundaries (install manifest, delete/get request) parse
 * through it, the mapper casts trusted persisted rows.
 */
export const McpFqnSchema = z
  .string()
  .min(1, "must be a non-empty string")
  .max(200, "must be at most 200 characters")
  .refine((s) => !/\s/.test(s), "must not contain whitespace")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  .refine((s) => !/[\u0000-\u001f\\]/.test(s), "must not contain control characters or backslashes")
  .refine((s) => /^[^/]+\/[^/]+$/.test(s), "must contain exactly one '/' (e.g. 'azure/mcp')")
  .refine((s) => !s.split("/").some((seg) => seg === "." || seg === ".."), "'.'/'..' not allowed")
  .brand("McpFqn");

export type McpFqn = z.infer<typeof McpFqnSchema>;
