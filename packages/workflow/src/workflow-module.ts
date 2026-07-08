import { randomBytes as cryptoRandomBytes, randomUUID as cryptoRandomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import { AddWorkflowSubgraphUseCase } from "./application/add-workflow-subgraph.js";
import { AggregateWorkflowsByOriginUseCase } from "./application/aggregate-workflows-by-origin.js";
import { CancelWorkflowUseCase } from "./application/cancel-workflow.js";
import { CancelWorkflowNodeUseCase } from "./application/cancel-workflow-node.js";
import { CountAwaitingHumanUseCase } from "./application/count-awaiting-human.js";
import { CreateWorkflowUseCase } from "./application/create-workflow.js";
import { DeleteWorkflowUseCase } from "./application/delete-workflow.js";
import { WorkflowEngine } from "./application/engine/workflow-engine.js";
import { FinishWorkflowUseCase } from "./application/finish-workflow.js";
import { GetWorkflowUseCase } from "./application/get-workflow.js";
import { GetWorkflowDagUseCase } from "./application/get-workflow-dag.js";
import { GetWorkflowNodeUseCase } from "./application/get-workflow-node.js";
import { ListWorkflowArtifactsUseCase } from "./application/list-workflow-artifacts.js";
import { ListWorkflowsUseCase } from "./application/list-workflows.js";
import type { WorkflowRunners } from "./application/ports/workflow-node-runner.js";
import { PruneWorkflowSubgraphUseCase } from "./application/prune-workflow-subgraph.js";
import { ResolveWorkflowArtifactPathUseCase } from "./application/resolve-workflow-artifact-path.js";
import { RespondToHumanNodeUseCase } from "./application/respond-to-human-node.js";
import type { Db } from "./infrastructure/drizzle/workflow-db.js";
import { DrizzleWorkflowQueries } from "./infrastructure/drizzle/workflow-queries.js";
import { DrizzleWorkflowRepository } from "./infrastructure/drizzle/workflow-repository.js";
import * as schema from "./infrastructure/drizzle/workflow-schema.js";
import { WorkflowSandbox, workflowRoot } from "./infrastructure/file/workflow-sandbox.js";

/**
 * Public surface of `@glyphs-ai/workflow`: a DI container of use-case instances
 * plus the stateful {@link WorkflowEngine} and lifecycle hooks. Consumers call
 * `module.<useCase>.execute(...)`; there is no service facade.
 *
 * The engine is the single stateful dependency, shared by every mutation
 * use-case (which nudges it post-commit) and exposed directly so hosts can
 * `drain()` it on shutdown. `close()` drains the engine; the caller-supplied
 * `db` is left open for the host to close.
 */
export interface WorkflowModule {
  readonly createWorkflow: CreateWorkflowUseCase;
  readonly deleteWorkflow: DeleteWorkflowUseCase;
  readonly cancelNode: CancelWorkflowNodeUseCase;
  readonly finishWorkflow: FinishWorkflowUseCase;
  readonly cancelWorkflow: CancelWorkflowUseCase;
  readonly addSubgraph: AddWorkflowSubgraphUseCase;
  readonly pruneSubgraph: PruneWorkflowSubgraphUseCase;
  readonly respondHumanNode: RespondToHumanNodeUseCase;
  readonly getWorkflow: GetWorkflowUseCase;
  readonly listWorkflows: ListWorkflowsUseCase;
  readonly getDag: GetWorkflowDagUseCase;
  readonly getNode: GetWorkflowNodeUseCase;
  readonly listWorkflowArtifacts: ListWorkflowArtifactsUseCase;
  readonly resolveWorkflowArtifactPath: ResolveWorkflowArtifactPathUseCase;
  readonly countAwaitingHuman: CountAwaitingHumanUseCase;
  readonly aggregateByOrigin: AggregateWorkflowsByOriginUseCase;
  /** The event-driven engine; hosts may `drain()` it directly on shutdown. */
  readonly engine: WorkflowEngine;
  /** Drain the engine. The host owns and closes the shared connection. */
  close(): Promise<void>;
}

export type WorkflowModuleOptions = {
  readonly db: Db;
  readonly workspaceDir: string;
  /** One runner per `WorkflowNodeKind`; injected at compose time. */
  readonly runners: WorkflowRunners;
  readonly logger?: Logger;
  /** Test seam: clock for id generation + timestamps. */
  readonly now?: () => Date;
  /** Test seam: random byte source seeding `generateWorkflowId`. */
  readonly randomBytes?: (n: number) => Buffer;
  /** Test seam: UUID source seeding `generateWorkflowNodeId`. */
  readonly randomUUID?: () => string;
};

/**
 * Assemble the module around a caller-provided drizzle handle over the
 * per-workspace `workspace.db`. The host owns the connection lifecycle;
 * package tests build one via `openTestDb` in `test/testing.ts`.
 */
export async function composeWorkflowModule(opts: WorkflowModuleOptions): Promise<WorkflowModule> {
  const logger = opts.logger ?? pino({ level: "silent" });
  const now = opts.now ?? (() => new Date());
  const randomBytes = opts.randomBytes ?? cryptoRandomBytes;
  const randomUUID = opts.randomUUID ?? cryptoRandomUUID;

  const { db } = opts;

  const repo = new DrizzleWorkflowRepository({ db, logger });
  const query = new DrizzleWorkflowQueries({ db });
  const sandbox = new WorkflowSandbox({ root: workflowRoot(opts.workspaceDir), logger });
  const engine = new WorkflowEngine({
    repo,
    query,
    runners: opts.runners,
    logger,
    now,
  });

  return {
    createWorkflow: new CreateWorkflowUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      sandbox,
      now,
      randomBytes,
      randomUUID,
    }),
    deleteWorkflow: new DeleteWorkflowUseCase({
      repo,
      sandbox,
    }),
    cancelNode: new CancelWorkflowNodeUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      now,
    }),
    finishWorkflow: new FinishWorkflowUseCase({ repo, coordinator: engine, now }),
    cancelWorkflow: new CancelWorkflowUseCase({ repo, coordinator: engine, now }),
    addSubgraph: new AddWorkflowSubgraphUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      now,
      randomUUID,
    }),
    pruneSubgraph: new PruneWorkflowSubgraphUseCase({ repo, coordinator: engine }),
    respondHumanNode: new RespondToHumanNodeUseCase({ repo, coordinator: engine, now }),
    getWorkflow: new GetWorkflowUseCase({ query }),
    listWorkflows: new ListWorkflowsUseCase({ query }),
    getDag: new GetWorkflowDagUseCase({ query }),
    getNode: new GetWorkflowNodeUseCase({ query }),
    listWorkflowArtifacts: new ListWorkflowArtifactsUseCase({
      query,
      sandbox,
      runners: opts.runners,
    }),
    resolveWorkflowArtifactPath: new ResolveWorkflowArtifactPathUseCase({
      query,
      sandbox,
      runners: opts.runners,
    }),
    countAwaitingHuman: new CountAwaitingHumanUseCase({ query }),
    aggregateByOrigin: new AggregateWorkflowsByOriginUseCase({ query }),
    engine,
    async close() {
      await engine.drain();
    },
  };
}

export type { Db };
export { schema };
