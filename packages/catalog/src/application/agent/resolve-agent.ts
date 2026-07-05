import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { AgentNotFound, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectInstalledMcpFqns } from "../mcp/mcp-reads.js";
import {
  collectReferencedSkillFqns,
  type SkillView,
  selectAllSkills,
} from "../skill/skill-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { selectAllAgents } from "./agent-reads.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

const AgentDependenciesSchema = z
  .object({
    skills: z.array(DependencyRefSchema).optional(),
    mcps: z.array(DependencyRefSchema).optional(),
    agents: z.array(DependencyRefSchema).optional(),
  })
  .optional();

const AgentSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  disabledByUser: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: AgentDependenciesSchema,
});

const SkillDependenciesSchema = z
  .object({
    skills: z.array(DependencyRefSchema).optional(),
    mcps: z.array(DependencyRefSchema).optional(),
  })
  .optional();

const SkillSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: SkillDependenciesSchema,
});

export const ResolveAgentRequestSchema = z.object({ id: AgentFqnSchema });
export type ResolveAgentRequest = z.infer<typeof ResolveAgentRequestSchema>;
const ResolvedSkillSchema = z.object({ skill: SkillSchema });
const ResolvedMcpSchema = z.object({ fqn: z.string() });
export const ResolveAgentResponseSchema = z.object({
  agent: AgentSchema,
  skills: z.array(ResolvedSkillSchema),
  mcps: z.array(ResolvedMcpSchema),
});
type ResolvedSkill = z.infer<typeof ResolvedSkillSchema>;
type ResolvedMcp = z.infer<typeof ResolvedMcpSchema>;
export type ResolveAgentResponse = z.infer<typeof ResolveAgentResponseSchema>;
export type ResolveAgentError = AgentNotFound | DatabaseUnavailable;
export interface ResolveAgentDeps {
  readonly queries: CatalogQueries;
}

export class ResolveAgentUseCase
  implements UseCase<ResolveAgentRequest, ResolveAgentResponse, ResolveAgentError>
{
  constructor(private readonly deps: ResolveAgentDeps) {}

  execute(request: ResolveAgentRequest): UseCaseResult<ResolveAgentResponse, ResolveAgentError> {
    const { id } = request;
    return this.deps.queries
      .query((db): ResolveAgentResponse | undefined => {
        const agents = selectAllAgents(db);
        const root = agents.find((agent) => agent.fqn === id);
        if (root === undefined) return undefined;

        const skills = selectAllSkills(db);
        const referencedSkillFqns = collectReferencedSkillFqns(db);
        const installedMcpFqns = selectInstalledMcpFqns(db);
        const skillByFqn = new Map<string, SkillView>(skills.map((skill) => [skill.fqn, skill]));

        const visited = new Set<string>();
        const orderedSkills: SkillView[] = [];
        const mcpFqns = new Set<string>();
        const walk = (skillDeps: readonly string[], mcpDeps: readonly string[]): void => {
          for (const fqn of mcpDeps) {
            if (installedMcpFqns.has(fqn)) mcpFqns.add(fqn);
          }
          for (const fqn of skillDeps) {
            if (visited.has(fqn)) continue;
            visited.add(fqn);
            const skill = skillByFqn.get(fqn);
            if (skill === undefined) continue;
            walk(skill.dependencyRefs.skills, skill.dependencyRefs.mcps);
            orderedSkills.push(skill);
          }
        };
        walk(root.dependencyRefs.skills, root.dependencyRefs.mcps);

        const agentDependencies =
          root.dependencyRefs.skills.length > 0 ||
          root.dependencyRefs.mcps.length > 0 ||
          root.dependencyRefs.agents.length > 0
            ? {
                ...(root.dependencyRefs.skills.length > 0
                  ? { skills: root.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(root.dependencyRefs.mcps.length > 0
                  ? { mcps: root.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
                ...(root.dependencyRefs.agents.length > 0
                  ? { agents: root.dependencyRefs.agents.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;

        return {
          agent: {
            fqn: root.fqn,
            origin: root.origin,
            description: root.description,
            version: root.version,
            ...(root.prereqs !== undefined ? { prereqs: root.prereqs } : {}),
            prereqsAck: root.prereqsAck,
            disabledByUser: root.disabledByUser,
            installedAt: root.installedAt,
            updatedAt: root.updatedAt,
            ...(agentDependencies !== undefined ? { dependencies: agentDependencies } : {}),
          },
          skills: orderedSkills.map<ResolvedSkill>((skill) => {
            const dependencies =
              skill.dependencyRefs.skills.length > 0 || skill.dependencyRefs.mcps.length > 0
                ? {
                    ...(skill.dependencyRefs.skills.length > 0
                      ? { skills: skill.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                      : {}),
                    ...(skill.dependencyRefs.mcps.length > 0
                      ? { mcps: skill.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                      : {}),
                  }
                : undefined;
            return {
              skill: {
                fqn: skill.fqn,
                origin: skill.origin,
                description: skill.description,
                version: skill.version,
                ...(skill.prereqs !== undefined ? { prereqs: skill.prereqs } : {}),
                prereqsAck: skill.prereqsAck,
                orphaned: !referencedSkillFqns.has(skill.fqn),
                installedAt: skill.installedAt,
                updatedAt: skill.updatedAt,
                ...(dependencies !== undefined ? { dependencies } : {}),
              },
            };
          }),
          mcps: [...mcpFqns].map<ResolvedMcp>((fqn) => ({ fqn })),
        };
      })
      .andThen(
        (dto): UseCaseResult<ResolveAgentResponse, ResolveAgentError> =>
          dto === undefined ? errAsync({ type: "AgentNotFound", fqn: id }) : okAsync(dto),
      );
  }
}
