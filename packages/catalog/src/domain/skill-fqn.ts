import { z } from "zod";

/**
 * Skill FQN — `<scope>/<short>` (e.g. `public/tool-use`). Branded so a
 * raw string can't be passed where a validated fqn is required.
 *
 * Grammar:
 *   - short: lowercase kebab, ≤64 chars, no `/`
 *   - scope: lowercase kebab + reverse-DNS dots, ≤64 chars
 *   - fqn: exactly `<scope>/<short>` (single `/`)
 *
 * Adapter boundaries parse through the schema; mappers cast trusted
 * persisted rows. `DEFAULT_SCOPE` is applied when frontmatter omits `scope:`.
 */
export const DEFAULT_SCOPE = "public";

const SHORT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SCOPE = `${SHORT}(?:\\.${SHORT})*`;
const FQN_RE = new RegExp(`^${SCOPE}\\/${SHORT}$`);

/** Scope segment — lowercase kebab + reverse-DNS dots, ≤64 chars. */
export const SkillScopeSchema = z
  .string()
  .max(64, "scope must be ≤64 chars")
  .regex(new RegExp(`^${SCOPE}$`), "scope must be lowercase kebab (dots allowed)")
  .default(DEFAULT_SCOPE)
  .brand("SkillScope");
export type SkillScope = z.infer<typeof SkillScopeSchema>;

/** Name segment — lowercase kebab, ≤64 chars, no `/`. */
export const SkillNameSchema = z
  .string()
  .max(64, "name must be ≤64 chars")
  .regex(new RegExp(`^${SHORT}$`), "name must be lowercase kebab")
  .brand("SkillName");
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillFqnSchema = z
  .string()
  .min(1, "must be a non-empty string")
  .refine((s) => s.split("/").length === 2, "must contain exactly one '/' (e.g. 'public/tool-use')")
  .refine((s) => s.split("/").every((seg) => seg.length <= 64), "each segment must be ≤64 chars")
  .refine((s) => FQN_RE.test(s), "must be lowercase kebab '<scope>/<name>' (dots allowed in scope)")
  .brand("SkillFqn");

export type SkillFqn = z.infer<typeof SkillFqnSchema>;

export const SkillFqn = {
  /** Compose a branded fqn from already-valid scope + name segments. */
  create(scope: SkillScope, name: SkillName): SkillFqn {
    return SkillFqnSchema.parse(`${scope}/${name}`);
  },
};
