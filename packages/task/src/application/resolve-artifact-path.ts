import path from "node:path";
import { z } from "zod";
import type { CorruptedTask } from "../domain/task-entity.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ResolveArtifactPathRequestSchema = z
  .object({ id: TaskIdSchema, name: z.string() })
  .strict();
export type ResolveArtifactPathRequest = z.infer<typeof ResolveArtifactPathRequestSchema>;

export type ResolveArtifactPathResponse = string | null;

export type ResolveArtifactPathError = CorruptedTask | DatabaseUnavailable;

export interface ResolveArtifactPathDeps {
  readonly repository: TaskRepository;
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
    return this.deps.repository.findById(id).map((task): string | null => {
      if (task === undefined || task.status === "running") return null;
      const requested = path.basename(name);
      if (requested === "" || requested === "." || requested === "..") return null;
      const allowed = task.success?.artifacts ?? [];
      const match = allowed.find((abs) => path.basename(abs) === requested);
      return match ?? null;
    });
  }
}
