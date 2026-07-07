/**
 * Request-scoped transaction middleware for Hono.
 *
 * Wraps the downstream handler in a single libsql/drizzle transaction.
 * On clean return the transaction commits; on throw it rolls back.
 * The per-package scope factories are constructed lazily from the
 * transaction handle and stored on the Hono context variables so route
 * handlers can access `c.var.scope.catalog.agentRepo`, etc.
 *
 * Usage (in the server mount):
 *
 *   app.use("/workspaces/:workspaceId/*", transactionMiddleware(getDb));
 *   app.get("/workspaces/:workspaceId/agents", (c) => {
 *     const { catalog } = c.var.scope;
 *     // catalog.queries, catalog.agentRepo, etc.
 *   });
 */

import type { Db as CatalogDb, CatalogScope, Tx as CatalogTx } from "@glyphs-ai/catalog";
import { createCatalogScope } from "@glyphs-ai/catalog";
import type { Db as ScheduleDb, ScheduleScope } from "@glyphs-ai/schedule";
import { createScheduleScope } from "@glyphs-ai/schedule";
import type { Db as SessionDb, SessionScope } from "@glyphs-ai/session";
import { createSessionScope } from "@glyphs-ai/session";
import type { Db as TaskDb, TaskScope } from "@glyphs-ai/task";
import { createTaskScope } from "@glyphs-ai/task";
import type { Db as WorkflowDb, WorkflowScope } from "@glyphs-ai/workflow";
import { createWorkflowScope } from "@glyphs-ai/workflow";
import type { Context, MiddlewareHandler } from "hono";

/**
 * The full request-scoped object placed on `c.var.scope`. Each property
 * lazily constructs the package's repos (on the tx) and queries (on db).
 */
export interface RequestScope {
  readonly catalog: CatalogScope;
  readonly session: SessionScope;
  readonly task: TaskScope;
  readonly schedule: ScheduleScope;
  readonly workflow: WorkflowScope;
}

/** Per-package db handles needed to build the scope. */
export interface ScopeDbHandles {
  readonly catalogDb: CatalogDb;
  readonly sessionDb: SessionDb;
  readonly taskDb: TaskDb;
  readonly scheduleDb: ScheduleDb;
  readonly workflowDb: WorkflowDb;
}

/**
 * Hono middleware that wraps each request in a database transaction.
 *
 * @param resolveHandles - Extracts the per-package db handles from context
 *   (typically from the loaded WorkspaceContext).
 */
export function transactionMiddleware(
  resolveHandles: (c: Context) => ScopeDbHandles,
): MiddlewareHandler {
  return async (c, next) => {
    const handles = resolveHandles(c);
    // Wrap in a catalog-db transaction (all packages share the same
    // underlying libsql client, so any package's db.transaction produces
    // a connection-level transaction covering all tables).
    await (handles.catalogDb as CatalogDb).transaction(async (tx: CatalogTx) => {
      const scope: RequestScope = {
        get catalog() {
          return createCatalogScope(tx, handles.catalogDb);
        },
        get session() {
          return createSessionScope(tx as unknown as SessionDb, handles.sessionDb);
        },
        get task() {
          return createTaskScope(tx as unknown as TaskDb, handles.taskDb);
        },
        get schedule() {
          return createScheduleScope(tx as unknown as ScheduleDb, handles.scheduleDb);
        },
        get workflow() {
          return createWorkflowScope(tx as unknown as WorkflowDb, handles.workflowDb);
        },
      };
      c.set("scope", scope);
      await next();
    });
  };
}
