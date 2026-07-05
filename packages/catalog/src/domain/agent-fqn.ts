import { z } from "zod";

/**
 * Agent FQN — `<scope>/<name>` (e.g. `public/triage`). Branded so a raw
 * string can't be passed where a validated fqn is required. Built from two
 * branded segments: a `scope` (lowercase kebab + reverse-DNS dots) and a
 * `name` (lowercase kebab). `AgentFqn.create(scope, name)` composes already
 * validated segments. The schema parses whole-string values; `DEFAULT_SCOPE`
 * is applied where frontmatter omits `scope:`.
 */
export const DEFAULT_SCOPE = "public";

const SHORT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SCOPE = `${SHORT}(?:\\.${SHORT})*`;
const FQN_RE = new RegExp(`^${SCOPE}\\/${SHORT}$`);

/** Scope segment — lowercase kebab + reverse-DNS dots, ≤64 chars. */
export const AgentScopeSchema = z
  .string()
  .max(64, "scope must be ≤64 chars")
  .regex(new RegExp(`^${SCOPE}$`), "scope must be lowercase kebab (dots allowed)")
  .default(DEFAULT_SCOPE)
  .brand("AgentScope");
export type AgentScope = z.infer<typeof AgentScopeSchema>;

/** Name segment — lowercase kebab, ≤64 chars, no `/`. */
export const AgentNameSchema = z
  .string()
  .max(64, "name must be ≤64 chars")
  .regex(new RegExp(`^${SHORT}$`), "name must be lowercase kebab")
  .brand("AgentName");
export type AgentName = z.infer<typeof AgentNameSchema>;

export const AgentFqnSchema = z
  .string()
  .min(1, "must be a non-empty string")
  .refine((s) => s.split("/").length === 2, "must contain exactly one '/' (e.g. 'public/triage')")
  .refine((s) => s.split("/").every((seg) => seg.length <= 64), "each segment must be ≤64 chars")
  .refine((s) => FQN_RE.test(s), "must be lowercase kebab '<scope>/<name>' (dots allowed in scope)")
  .brand("AgentFqn");

export type AgentFqn = z.infer<typeof AgentFqnSchema>;

export const AgentFqn = {
  /** Compose a branded fqn from already-valid scope + name segments. */
  create(scope: AgentScope, name: AgentName): AgentFqn {
    return AgentFqnSchema.parse(`${scope}/${name}`);
  },
};
