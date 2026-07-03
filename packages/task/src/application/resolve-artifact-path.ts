import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { projectTaskRow, type TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ResolveArtifactPathRequestSchema = z
  .object({ id: TaskIdSchema, name: z.string() })
  .strict();
export type ResolveArtifactPathRequest = z.infer<typeof ResolveArtifactPathRequestSchema>;

export type ResolveArtifactPathResponse = string | null;

export type ResolveArtifactPathError = DatabaseUnavailable;

export interface ResolveArtifactPathDeps {
  readonly query: TaskQueries;
}

/**
 * Resolve a downloadable artifact for a terminal task to its absolute fs
 * path, or `null` when the task is unknown / non-terminal / missing the
 * artifact. The whitelist (`task.success.artifacts`) is the security
 * boundary; matching is by `path.basename` so HTTP callers only need the
 * leaf filename and cross-platform persisted paths resolve identically.
 */
export class ResolveArtifactPathUseCase
  implements
    UseCase<ResolveArtifactPathRequest, ResolveArtifactPathResponse, ResolveArtifactPathError>
{
  constructor(private readonly deps: ResolveArtifactPathDeps) {}

  execute(
    request: ResolveArtifactPathRequest,
  ): UseCaseResult<ResolveArtifactPathResponse, ResolveArtifactPathError> {
    const { id, name } = ResolveArtifactPathRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query((db): ResolveArtifactPathResponse => {
      const row = db.select().from(q.tasks).where(eq(q.tasks.id, id)).get();
      if (row === undefined) return null;
      const view = projectTaskRow(row);
      if (view.status === "running") return null;
      const requested = path.basename(name);
      if (requested === "" || requested === "." || requested === "..") return null;
      const allowed = view.success?.artifacts ?? [];
      const match = allowed.find((abs) => path.basename(abs) === requested);
      return match ?? null;
    });
  }
}
