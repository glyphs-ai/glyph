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

import type { Db as CatalogDb, CatalogScope } from "@glyphs-ai/catalog";
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
 * Scopes are memoized: repeated access yields the same instance so
 * repo-level identity tracking (e.g. WeakMap snapshots) is preserved.
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
    await (handles.catalogDb as CatalogDb).transaction(async (tx: CatalogDb) => {
      // All domain pkgs share one libsql connection, so the catalog tx
      // handle is structurally identical to each pkg's Db type (both are
      // `BaseSQLiteDatabase<"async", ResultSet, typeof pkgSchema>`).
      // The schema type parameter differs but is unused at runtime when
      // repos use the builder API. Casts go through `unknown` because
      // TypeScript's schema generics are nominally incompatible.
      const sessionTx = tx as unknown as SessionDb;
      const taskTx = tx as unknown as TaskDb;
      const scheduleTx = tx as unknown as ScheduleDb;
      const workflowTx = tx as unknown as WorkflowDb;

      let _catalog: CatalogScope | undefined;
      let _session: SessionScope | undefined;
      let _task: TaskScope | undefined;
      let _schedule: ScheduleScope | undefined;
      let _workflow: WorkflowScope | undefined;

      const scope: RequestScope = {
        get catalog() {
          if (!_catalog) _catalog = createCatalogScope(tx, handles.catalogDb);
          return _catalog;
        },
        get session() {
          if (!_session) _session = createSessionScope(sessionTx, handles.sessionDb);
          return _session;
        },
        get task() {
          if (!_task) _task = createTaskScope(taskTx, handles.taskDb);
          return _task;
        },
        get schedule() {
          if (!_schedule) _schedule = createScheduleScope(scheduleTx, handles.scheduleDb);
          return _schedule;
        },
        get workflow() {
          if (!_workflow) _workflow = createWorkflowScope(workflowTx, handles.workflowDb);
          return _workflow;
        },
      };
      c.set("scope", scope);
      await next();
    });
  };
}
