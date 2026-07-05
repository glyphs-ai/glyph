import { err, ok, type Result, ResultAsync } from "neverthrow";
import { z } from "zod";
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

export const ListWorkflowArtifactsRequestSchema = z
  .object({ workflowId: WorkflowIdSchema })
  .strict();
export type ListWorkflowArtifactsRequest = z.infer<typeof ListWorkflowArtifactsRequestSchema>;

export type WorkflowArtifactEntry =
  | {
      readonly kind: "workflow-summary";
      readonly relPath: string;
      readonly size: number;
      readonly modifiedAt: string;
    }
  | {
      readonly kind: "node";
      readonly nodeId: string;
      readonly relPath: string;
      readonly size: number;
      readonly modifiedAt: string;
    };

export const WorkflowArtifactEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workflow-summary"),
      relPath: z.string(),
      size: z.number(),
      modifiedAt: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("node"),
      nodeId: z.string(),
      relPath: z.string(),
      size: z.number(),
      modifiedAt: z.string(),
    })
    .strict(),
]);
export const ListWorkflowArtifactsResponseSchema = z.object({
  artifacts: z.array(WorkflowArtifactEntrySchema).readonly(),
});
export interface ListWorkflowArtifactsResponse {
  readonly artifacts: readonly WorkflowArtifactEntry[];
}

export type ListWorkflowArtifactsError =
  | WorkflowNotFound
  | WorkflowEntityCorruption
  | DatabaseUnavailable
  | WorkflowArtifactListingFailed;

export interface ListWorkflowArtifactsDeps {
  readonly query: WorkflowQueries;
  readonly sandbox: WorkflowSandbox;
  readonly runners: WorkflowRunners;
}

export class ListWorkflowArtifactsUseCase
  implements
    UseCase<ListWorkflowArtifactsRequest, ListWorkflowArtifactsResponse, ListWorkflowArtifactsError>
{
  constructor(private readonly deps: ListWorkflowArtifactsDeps) {}

  execute(
    request: ListWorkflowArtifactsRequest,
  ): UseCaseResult<ListWorkflowArtifactsResponse, ListWorkflowArtifactsError> {
    const { workflowId } = ListWorkflowArtifactsRequestSchema.parse(request);
    const getDag = new GetWorkflowDagUseCase({ query: this.deps.query });
    return getDag.execute({ workflowId }).andThen(
      (snapshot) =>
        new ResultAsync(
          (async (): Promise<
            Result<ListWorkflowArtifactsResponse, WorkflowArtifactListingFailed>
          > => {
            let summaryFiles: Awaited<ReturnType<WorkflowSandbox["listArtifacts"]>>;
            try {
              summaryFiles = await this.deps.sandbox.listArtifacts(workflowId);
            } catch (cause) {
              return err({ type: "WorkflowArtifactListingFailed", cause });
            }
            const artifacts: WorkflowArtifactEntry[] = summaryFiles.map((f) => ({
              kind: "workflow-summary",
              relPath: f.relPath,
              size: f.size,
              modifiedAt: f.modifiedAt,
            }));

            const nodes = [...snapshot.nodes].sort((a, b) => a.id.localeCompare(b.id));
            for (const node of nodes) {
              const listingResult = await runnerFor(this.deps.runners, node.kind).listArtifacts(
                node.id,
              );
              if (listingResult.isErr()) {
                return err({
                  type: "WorkflowArtifactListingFailed",
                  cause: listingResult.error.cause,
                });
              }
              const listing = listingResult.value;
              if (listing === null) continue;
              for (const f of listing.artifacts) {
                artifacts.push({
                  kind: "node",
                  nodeId: node.id,
                  relPath: f.relPath,
                  size: f.size,
                  modifiedAt: f.modifiedAt,
                });
              }
            }

            return ok({ artifacts });
          })(),
        ),
    );
  }
}
