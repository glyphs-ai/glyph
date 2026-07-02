import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/workflow/workflow-repository.js";
import type { Db } from "./workflow-db.js";
import { workflowEdges, workflowNodes, workflows } from "./workflow-schema.js";

/**
 * Read-side port for the workflow CQRS query model. Exposes the three tables so
 * read use-cases compose their own SELECTs (incl. DB-side COUNT / GROUP BY) and
 * run them through {@link WorkflowQueries.query}, which captures a driver throw
 * as `DatabaseUnavailable`. The interface lives beside its Drizzle implementation
 * (not in the domain) because it deliberately exposes the Drizzle handle + table
 * objects — the read side is intentionally infrastructure-coupled.
 */
export interface WorkflowQueries {
  readonly workflows: typeof workflows;
  readonly workflowNodes: typeof workflowNodes;
  readonly workflowEdges: typeof workflowEdges;
  /** Run one read fn; a driver throw becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleWorkflowQueries implements WorkflowQueries {
  private readonly db: Db;
  readonly workflows = workflows;
  readonly workflowNodes = workflowNodes;
  readonly workflowEdges = workflowEdges;

  constructor(opts: { readonly db: Db }) {
    this.db = opts.db;
  }

  query<T>(fn: (db: Db) => T): ResultAsync<T, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() => fn(this.db)),
      (cause) => ({
        type: "DatabaseUnavailable",
        cause,
      }),
    );
  }
}
