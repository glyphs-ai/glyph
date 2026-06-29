import { err, ok } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import type { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

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
  readonly agentRepo: AgentRepository;
  readonly skillRepo: SkillRepository;
  readonly mcpRepo: McpRepository;
}

export class ResolveAgentUseCase
  implements UseCase<ResolveAgentRequest, ResolveAgentResponse, ResolveAgentError>
{
  constructor(private readonly deps: ResolveAgentDeps) {}

  async execute(
    request: ResolveAgentRequest,
  ): UseCaseResult<ResolveAgentResponse, ResolveAgentError> {
    const agents = await this.deps.agentRepo.list();
    if (agents.isErr()) return err(agents.error);
    const skills = await this.deps.skillRepo.list();
    if (skills.isErr()) return err(skills.error);
    const mcps = await this.deps.mcpRepo.list();
    if (mcps.isErr()) return err(mcps.error);

    const root = agents.value.find((agent) => agent.fqn === request.id);
    if (root === undefined) return err({ type: "AgentNotFound", fqn: request.id });

    const referencedSkillFqns = new Set<string>();
    const referencedMcpFqns = new Set<string>();
    for (const agent of agents.value) {
      for (const fqn of agent.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      for (const fqn of agent.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    for (const skill of skills.value) {
      for (const fqn of skill.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      for (const fqn of skill.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    const skillByFqn = new Map<string, SkillEntity>(
      skills.value.map((skill) => [skill.fqn, skill] as const),
    );
    const mcpByFqn = new Map<string, (typeof mcps.value)[number]>(
      mcps.value.map((mcp) => [mcp.fqn, mcp] as const),
    );

    const visited = new Set<string>();
    const orderedSkills: SkillEntity[] = [];
    const mcpFqns = new Set<string>();
    const walk = (skillDeps: readonly string[], mcpDeps: readonly string[]): void => {
      for (const fqn of mcpDeps) {
        const mcp = mcpByFqn.get(fqn);
        if (mcp !== undefined) mcpFqns.add(mcp.fqn);
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

    return ok({
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
    });
  }
}
