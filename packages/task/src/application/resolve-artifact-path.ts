import { eq } from "drizzle-orm";
import { z } from "zod";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import type { TaskSandbox } from "../domain/task-sandbox.js";
import type { TaskSuccess } from "../domain/task-success.js";
import { normalizeArtifactRel, type TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ResolveArtifactPathRequestSchema = z
  .object({ id: TaskIdSchema, relPath: z.string() })
  .strict();
export type ResolveArtifactPathRequest = z.infer<typeof ResolveArtifactPathRequestSchema>;

export type ResolveArtifactPathResponse = string | null;

export type ResolveArtifactPathError = DatabaseUnavailable;

export interface ResolveArtifactPathDeps {
  readonly query: TaskQueries;
  readonly sandbox: TaskSandbox;
}

/**
 * Resolve a downloadable artifact for a terminal task to its absolute fs
 * path, or `null` when the task is unknown / non-terminal / not on the
 * whitelist. The whitelist (`task.success.artifacts`, each a POSIX path
 * relative to the task's `artifact/` dir) is the authorization boundary;
 * the sandbox then joins the matched relPath under the artifact root and
 * refuses any escape, so the returned path always stays inside the sandbox.
 */
export class ResolveArtifactPathUseCase
  implements
    UseCase<ResolveArtifactPathRequest, ResolveArtifactPathResponse, ResolveArtifactPathError>
{
  constructor(private readonly deps: ResolveArtifactPathDeps) {}

  execute(
    request: ResolveArtifactPathRequest,
  ): UseCaseResult<ResolveArtifactPathResponse, ResolveArtifactPathError> {
    const { id, relPath } = ResolveArtifactPathRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query(async (db): Promise<boolean> => {
        const row = await db.select().from(q.tasks).where(eq(q.tasks.id, id)).get();
        if (row === undefined || row.status === "running") return false;
        const success = row.success !== null ? (JSON.parse(row.success) as TaskSuccess) : undefined;
        const allowed = (success?.artifacts ?? []).map((a) => normalizeArtifactRel(a, id));
        return allowed.includes(relPath);
      })
      .map((authorized) =>
        authorized ? this.deps.sandbox.resolveArtifactPath(id, relPath) : null,
      );
  }
}
