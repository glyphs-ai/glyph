import { okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import type { WorkflowArtifactListingFailed } from "../domain/workflow/workflow-artifact.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { WorkflowSandbox } from "../infrastructure/file/workflow-sandbox.js";
import { GetWorkflowDagUseCase } from "./get-workflow-dag.js";
import { runnerFor, type WorkflowRunners } from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

const WorkflowArtifactRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), relPath: z.string() }).strict(),
  z.object({ kind: z.literal("node"), nodeId: WorkflowNodeIdSchema, relPath: z.string() }).strict(),
]);
export type WorkflowArtifactRef = z.infer<typeof WorkflowArtifactRefSchema>;

export const ResolveWorkflowArtifactPathRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, ref: WorkflowArtifactRefSchema })
  .strict();
export type ResolveWorkflowArtifactPathRequest = z.infer<
  typeof ResolveWorkflowArtifactPathRequestSchema
>;

export const ResolveWorkflowArtifactPathResponseSchema = z.string().nullable();
export type ResolveWorkflowArtifactPathResponse = z.infer<
  typeof ResolveWorkflowArtifactPathResponseSchema
>;

export type ResolveWorkflowArtifactPathError =
  | WorkflowNotFound
  | WorkflowEntityCorruption
  | DatabaseUnavailable
  | WorkflowArtifactListingFailed;

export interface ResolveWorkflowArtifactPathDeps {
  readonly query: WorkflowQueries;
  readonly sandbox: WorkflowSandbox;
  readonly runners: WorkflowRunners;
}

export class ResolveWorkflowArtifactPathUseCase
  implements
    UseCase<
      ResolveWorkflowArtifactPathRequest,
      ResolveWorkflowArtifactPathResponse,
      ResolveWorkflowArtifactPathError
    >
{
  constructor(private readonly deps: ResolveWorkflowArtifactPathDeps) {}

  execute(
    request: ResolveWorkflowArtifactPathRequest,
  ): UseCaseResult<ResolveWorkflowArtifactPathResponse, ResolveWorkflowArtifactPathError> {
    const { workflowId, ref } = ResolveWorkflowArtifactPathRequestSchema.parse(request);
    if (ref.kind === "summary") {
      return okAsync(this.deps.sandbox.resolveArtifactPath(workflowId, ref.relPath));
    }

    const getDag = new GetWorkflowDagUseCase({ query: this.deps.query });
    return getDag.execute({ workflowId }).andThen((snapshot) => {
      const node = snapshot.nodes.find((n) => n.id === ref.nodeId);
      if (node === undefined) return okAsync(null);
      return ResultAsync.fromPromise(
        runnerFor(this.deps.runners, node.kind).resolveArtifactPath(ref.nodeId, ref.relPath),
        (cause): WorkflowArtifactListingFailed => ({
          type: "WorkflowArtifactListingFailed",
          cause,
        }),
      );
    });
  }
}
