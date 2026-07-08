/**
 * Request-scoped transaction middleware for Hono.
 *
 * - **Read requests (GET, HEAD, OPTIONS):** no transaction. Scope factories
 *   receive the stable `db` handle for both reads and writes — concurrent
 *   readers are fully parallel under SQLite WAL.
 * - **Write requests (POST, PATCH, PUT, DELETE):** wrapped in a DEFERRED
 *   transaction via raw SQL on the shared drizzle handle. The write lock
 *   is acquired only when the first write SQL executes (not at BEGIN), so
 *   concurrent write requests queue on `busy_timeout` instead of failing
 *   immediately.
 *
 * Why raw SQL instead of `db.transaction()`? drizzle-orm@0.45 ignores the
 * `behavior` config and hardcodes `client.transaction("write")` which maps
 * to `BEGIN IMMEDIATE` — exclusive write lock at BEGIN, serialising ALL
 * requests (including reads) through one connection. Raw `BEGIN DEFERRED`
 * avoids this. Once drizzle ships the fix (PR #4577), we can switch back
 * to `db.transaction(fn, { behavior: "deferred" })`.
 *
 * Usage (in the server mount):
 *
 *   app.use("/workspaces/:workspaceId/*", transactionMiddleware(getHandles));
 */

import type { ScopeDbHandles } from "@glyphs-ai/api";
import { type CatalogScope, createCatalogScope } from "@glyphs-ai/catalog";
import { createScheduleScope, type ScheduleScope } from "@glyphs-ai/schedule";
import { createSessionScope, type SessionScope } from "@glyphs-ai/session";
import { createTaskScope, type TaskScope } from "@glyphs-ai/task";
import { createWorkflowScope, type WorkflowScope } from "@glyphs-ai/workflow";
import { sql } from "drizzle-orm";
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

/**
 * Hono middleware that provides request-scoped database access.
 *
 * @param resolveHandles - Extracts the per-package db handles from context
 *   (typically from the loaded WorkspaceContext).
 */
export function transactionMiddleware(
  resolveHandles: (c: Context) => ScopeDbHandles,
): MiddlewareHandler {
  return async (c, next) => {
    const handles = resolveHandles(c);
    const method = c.req.method;

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      // Reads: no transaction needed. WAL mode supports unlimited
      // concurrent readers without blocking.
      c.set("scope", buildScope(handles));
      await next();
    } else {
      // Writes: wrap in a DEFERRED transaction via raw SQL on the shared
      // drizzle handle. DEFERRED acquires the write lock only on the first
      // write statement, so concurrent write requests queue on busy_timeout
      // (5s) instead of failing immediately like BEGIN IMMEDIATE would.
      await handles.db.run(sql.raw("BEGIN DEFERRED"));
      try {
        c.set("scope", buildScope(handles));
        await next();
        if (c.error || (c.res && c.res.status >= 500)) {
          try {
            await handles.db.run(sql.raw("ROLLBACK"));
          } catch {
            // Best-effort: preserve the original error context. SQLite
            // auto-rolls back when the connection releases anyway.
          }
        } else {
          await handles.db.run(sql.raw("COMMIT"));
        }
      } catch (e) {
        try {
          await handles.db.run(sql.raw("ROLLBACK"));
        } catch {
          // Best-effort: preserve the original error. SQLite auto-rolls
          // back on connection release, so a failed ROLLBACK is harmless.
        }
        throw e;
      }
    }
  };
}

function buildScope(handles: ScopeDbHandles): RequestScope {
  // All pkg db handles point to the same underlying connection. The
  // BEGIN DEFERRED / COMMIT boundary (for writes) is managed by the
  // middleware on `handles.db`; repos and queries both use their
  // typed handles which route through the same connection.
  let _catalog: CatalogScope | undefined;
  let _session: SessionScope | undefined;
  let _task: TaskScope | undefined;
  let _schedule: ScheduleScope | undefined;
  let _workflow: WorkflowScope | undefined;

  return {
    get catalog() {
      if (!_catalog) _catalog = createCatalogScope(handles.catalogDb, handles.catalogDb);
      return _catalog;
    },
    get session() {
      if (!_session) _session = createSessionScope(handles.sessionDb, handles.sessionDb);
      return _session;
    },
    get task() {
      if (!_task) _task = createTaskScope(handles.taskDb, handles.taskDb);
      return _task;
    },
    get schedule() {
      if (!_schedule) _schedule = createScheduleScope(handles.scheduleDb, handles.scheduleDb);
      return _schedule;
    },
    get workflow() {
      if (!_workflow) _workflow = createWorkflowScope(handles.workflowDb, handles.workflowDb);
      return _workflow;
    },
  };
}
