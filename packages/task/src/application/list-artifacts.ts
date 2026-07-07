import { eq } from "drizzle-orm";
import { okAsync } from "neverthrow";
import { z } from "zod";
import type { TaskArtifactFile } from "../domain/task-artifact.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import type { ArtifactListingFailed, TaskSandbox } from "../domain/task-sandbox.js";
import type { TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListArtifactsRequestSchema = z.object({ id: TaskIdSchema }).strict();
export type ListArtifactsRequest = z.infer<typeof ListArtifactsRequestSchema>;

export type ListArtifactsResponse = readonly TaskArtifactFile[];

export type ListArtifactsError = DatabaseUnavailable | ArtifactListingFailed;

export interface ListArtifactsDeps {
  readonly query: TaskQueries;
  readonly sandbox: TaskSandbox;
}

/**
 * List a succeeded task's artifacts — each relative to the task's
 * `artifact/` dir, with size + mtime — by scanning that dir. Running,
 * failed, cancelled, and unknown tasks have no downloadable artifacts, so
 * they resolve to `[]`. The sandbox owns the on-disk scan, so callers never
 * reconstruct the task's fs layout.
 */
export class ListArtifactsUseCase
  implements UseCase<ListArtifactsRequest, ListArtifactsResponse, ListArtifactsError>
{
  constructor(private readonly deps: ListArtifactsDeps) {}

  execute(request: ListArtifactsRequest): UseCaseResult<ListArtifactsResponse, ListArtifactsError> {
    const { id } = ListArtifactsRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query(async (db): Promise<boolean> => {
        const row = await db
          .select({ success: q.tasks.success })
          .from(q.tasks)
          .where(eq(q.tasks.id, id))
          .get();
        return row !== undefined && row.success !== null;
      })
      .andThen((hasArtifacts) =>
        hasArtifacts
          ? this.deps.sandbox.listArtifacts(this.deps.sandbox.resolve(id))
          : okAsync<ListArtifactsResponse, ArtifactListingFailed>([]),
      );
  }
}
