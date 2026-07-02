import { randomBytes as cryptoRandomBytes, randomUUID as cryptoRandomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import { AddWorkflowEdgeUseCase } from "./application/add-workflow-edge.js";
import { AddWorkflowNodeUseCase } from "./application/add-workflow-node.js";
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
import { ListWorkflowsUseCase } from "./application/list-workflows.js";
import type { WorkflowRunners } from "./application/ports/workflow-node-runner.js";
import { PurgeWorkflowUseCase } from "./application/purge-workflow.js";
import { RemoveWorkflowEdgeUseCase } from "./application/remove-workflow-edge.js";
import { RemoveWorkflowNodeUseCase } from "./application/remove-workflow-node.js";
import { ReplaceWorkflowNodeSpecUseCase } from "./application/replace-workflow-node-spec.js";
import { RespondToHumanNodeUseCase } from "./application/respond-to-human-node.js";
import { type Db, openDb } from "./infrastructure/drizzle/workflow-db.js";
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
 * `drain()` it on shutdown. `close()` drains the engine then closes the SQLite
 * connection the module owns (a caller-supplied `db` is left open).
 */
export interface WorkflowModule {
  readonly createWorkflow: CreateWorkflowUseCase;
  readonly deleteWorkflow: DeleteWorkflowUseCase;
  readonly purgeWorkflow: PurgeWorkflowUseCase;
  readonly addNode: AddWorkflowNodeUseCase;
  readonly addEdge: AddWorkflowEdgeUseCase;
  readonly cancelNode: CancelWorkflowNodeUseCase;
  readonly finishWorkflow: FinishWorkflowUseCase;
  readonly cancelWorkflow: CancelWorkflowUseCase;
  readonly removeNode: RemoveWorkflowNodeUseCase;
  readonly removeEdge: RemoveWorkflowEdgeUseCase;
  readonly replaceNodeSpec: ReplaceWorkflowNodeSpecUseCase;
  readonly addSubgraph: AddWorkflowSubgraphUseCase;
  readonly respondHumanNode: RespondToHumanNodeUseCase;
  readonly getWorkflow: GetWorkflowUseCase;
  readonly listWorkflows: ListWorkflowsUseCase;
  readonly getDag: GetWorkflowDagUseCase;
  readonly getNode: GetWorkflowNodeUseCase;
  readonly countAwaitingHuman: CountAwaitingHumanUseCase;
  readonly aggregateByOrigin: AggregateWorkflowsByOriginUseCase;
  /** The event-driven engine; hosts may `drain()` it directly on shutdown. */
  readonly engine: WorkflowEngine;
  /** Drain the engine and close the module-owned SQLite connection. */
  close(): Promise<void>;
}

export type WorkflowModuleOptions = (
  | { readonly db: Db; readonly dbFile?: never }
  | { readonly dbFile: string; readonly db?: never }
) & {
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
 * Open the workflow DB (WAL + migrations) and assemble the module. Production
 * callers pass `dbFile` (the per-workspace `workspace.db`); tests pass an
 * existing `db` (e.g. `:memory:`) which the module does NOT close.
 */
export async function composeWorkflowModule(opts: WorkflowModuleOptions): Promise<WorkflowModule> {
  const logger = opts.logger ?? pino({ level: "silent" });
  const now = opts.now ?? (() => new Date());
  const randomBytes = opts.randomBytes ?? cryptoRandomBytes;
  const randomUUID = opts.randomUUID ?? cryptoRandomUUID;

  let db: Db;
  let closeDb: () => void;
  if ("db" in opts && opts.db !== undefined) {
    db = opts.db;
    closeDb = () => {};
  } else {
    const opened = openDb(opts.dbFile as string);
    db = opened.db;
    closeDb = opened.close;
  }

  const repo = new DrizzleWorkflowRepository({ db, logger });
  const query = new DrizzleWorkflowQueries({ db });
  const sandbox = new WorkflowSandbox({ root: workflowRoot(opts.workspaceDir), logger });
  const engine = new WorkflowEngine({
    repo,
    query,
    runners: opts.runners,
    logger,
    now,
    randomUUID,
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
    purgeWorkflow: new PurgeWorkflowUseCase({ sandbox }),
    addNode: new AddWorkflowNodeUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      now,
      randomUUID,
    }),
    addEdge: new AddWorkflowEdgeUseCase({ repo, coordinator: engine }),
    cancelNode: new CancelWorkflowNodeUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      now,
    }),
    finishWorkflow: new FinishWorkflowUseCase({ repo, coordinator: engine, now }),
    cancelWorkflow: new CancelWorkflowUseCase({ repo, coordinator: engine, now }),
    removeNode: new RemoveWorkflowNodeUseCase({ repo, coordinator: engine }),
    removeEdge: new RemoveWorkflowEdgeUseCase({ repo, coordinator: engine }),
    replaceNodeSpec: new ReplaceWorkflowNodeSpecUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
    }),
    addSubgraph: new AddWorkflowSubgraphUseCase({
      repo,
      coordinator: engine,
      runners: opts.runners,
      now,
      randomUUID,
    }),
    respondHumanNode: new RespondToHumanNodeUseCase({ repo, coordinator: engine, now }),
    getWorkflow: new GetWorkflowUseCase({ query }),
    listWorkflows: new ListWorkflowsUseCase({ query }),
    getDag: new GetWorkflowDagUseCase({ query }),
    getNode: new GetWorkflowNodeUseCase({ query }),
    countAwaitingHuman: new CountAwaitingHumanUseCase({ query }),
    aggregateByOrigin: new AggregateWorkflowsByOriginUseCase({ query }),
    engine,
    async close() {
      await engine.drain();
      closeDb();
    },
  };
}

export type { Db };
export { schema };
