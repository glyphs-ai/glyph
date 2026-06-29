/**
 * Declared dependency origins for a skill.
 *
 * Skills may depend on other skills and MCPs. Origins are stored verbatim;
 * the resolve pipeline maps them to sibling fqns.
 */
export interface SkillDependencyRefs {
  readonly skills: readonly string[];
  readonly mcps: readonly string[];
}
