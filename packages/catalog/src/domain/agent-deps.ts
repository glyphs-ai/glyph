/**
 * Declared dependency origins for an agent.
 *
 * Agents may depend on skills, MCPs, and other agents. Origins are stored
 * verbatim; the resolve pipeline maps them to sibling fqns.
 */
export interface AgentDependencyRefs {
  readonly skills: readonly string[];
  readonly mcps: readonly string[];
  readonly agents: readonly string[];
}
