/**
 * Use case: list installed skills. Request is empty (uniform dispatch shape).
 */

import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedSkillFqns, selectAllSkills } from "./skill-reads.js";

const listSkillsDependencies = z
  .object({
    skills: z.array(z.object({ fqn: z.string() })).optional(),
    mcps: z.array(z.object({ fqn: z.string() })).optional(),
  })
  .optional();

// Deliberate duplication: this skill projection is intentionally NOT shared
// with the sibling skill use cases that expose the same shape. Each owns its
// V1 response so a later evolution of one caller never drags the others along
// in lockstep. Redundancy > coupling.
const listSkillsEntry = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: listSkillsDependencies,
});

export const ListSkillsRequestSchema = z.object({});
export type ListSkillsRequest = z.infer<typeof ListSkillsRequestSchema>;
export const ListSkillsResponseSchema = z.array(listSkillsEntry);
export type ListSkillsResponse = z.infer<typeof ListSkillsResponseSchema>;
export type ListSkillsError = DatabaseUnavailable;

export interface ListSkillsDeps {
  readonly queries: CatalogQueries;
}

export class ListSkillsUseCase
  implements UseCase<ListSkillsRequest, ListSkillsResponse, ListSkillsError>
{
  constructor(private readonly deps: ListSkillsDeps) {}

  execute(_request: ListSkillsRequest): UseCaseResult<ListSkillsResponse, ListSkillsError> {
    return this.deps.queries.query((db) => {
      const referencedSkillFqns = collectReferencedSkillFqns(db);
      return selectAllSkills(db).map((skill) => {
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
        };
      });
    });
  }
}
