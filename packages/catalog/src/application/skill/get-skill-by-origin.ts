/**
 * Use case: reverse-lookup an installed skill by source origin.
 *
 * Origin is matched verbatim against the stored provenance string.
 * `SkillNotFound` is keyed by origin when nothing matches.
 */

import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { RegistryOriginSchema } from "../../domain/registry-origin.js";
import type { SkillNotFound } from "../../domain/skill-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { skills } from "../../infrastructure/drizzle/skill-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetSkillByOriginRequestSchema = z.object({
  origin: RegistryOriginSchema,
});
export type GetSkillByOriginRequest = z.infer<typeof GetSkillByOriginRequestSchema>;

export const GetSkillByOriginResponseSchema = z.object({
  id: z.string(),
  origin: z.string(),
  version: z.string(),
});
export type GetSkillByOriginResponse = z.infer<typeof GetSkillByOriginResponseSchema>;

export type GetSkillByOriginError = SkillNotFound | DatabaseUnavailable;

export interface GetSkillByOriginDeps {
  readonly queries: CatalogQueries;
}

export class GetSkillByOriginUseCase
  implements UseCase<GetSkillByOriginRequest, GetSkillByOriginResponse, GetSkillByOriginError>
{
  constructor(private readonly deps: GetSkillByOriginDeps) {}

  execute(
    request: GetSkillByOriginRequest,
  ): UseCaseResult<GetSkillByOriginResponse, GetSkillByOriginError> {
    const { origin } = request;
    return this.deps.queries
      .query(async (db) => await db.select().from(skills).where(eq(skills.origin, origin)).get())
      .andThen(
        (row): UseCaseResult<GetSkillByOriginResponse, GetSkillByOriginError> =>
          row === undefined
            ? errAsync({ type: "SkillNotFound", fqn: origin })
            : okAsync({ id: row.fqn, origin: row.origin, version: row.version }),
      );
  }
}
