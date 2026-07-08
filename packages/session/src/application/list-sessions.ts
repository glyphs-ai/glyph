import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { and, eq, gte, type SQL } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import { type SessionId, SessionIdSchema } from "../domain/session-id.js";
import type { DatabaseUnavailable } from "../domain/session-repository.js";
import type { SessionSandbox } from "../domain/session-sandbox.js";
import type { SessionRow } from "../infrastructure/drizzle/session-db.js";
import type { SessionQueries } from "../infrastructure/drizzle/session-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListSessionsRequestSchema = z
  .object({
    agent: z.string().optional(),
    createdSince: z.string().optional(),
    activeSince: z.string().optional(),
  })
  .strict();
export type ListSessionsRequest = z.infer<typeof ListSessionsRequestSchema>;

export const ListSessionsResponseSchema = z.array(
  z.object({
    id: SessionIdSchema,
    workdir: z.string(),
    agent: z.string(),
    runtime: z.string(),
    runtimeSessionId: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string().nullable(),
    preview: z.string().nullable(),
    lastLaunchMode: z.enum(["local", "remote"]).nullable(),
  }),
);
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export type ListSessionsError = DatabaseUnavailable;

export interface ListSessionsDeps {
  readonly query: SessionQueries;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: SessionSandbox;
}

/**
 * List sessions (newest activity first). Sessions whose runtime is no
 * longer registered are dropped; live `lastActiveAt` / `preview` are
 * refreshed per row (best-effort). `activeSince` filters on the
 * refreshed activity.
 */
export class ListSessionsUseCase
  implements UseCase<ListSessionsRequest, ListSessionsResponse, ListSessionsError>
{
  constructor(private readonly deps: ListSessionsDeps) {}

  execute(request: ListSessionsRequest): UseCaseResult<ListSessionsResponse, ListSessionsError> {
    const { agent, createdSince, activeSince } = ListSessionsRequestSchema.parse(request);
    const deps = this.deps;
    const q = deps.query;
    return q
      .query(async (db) => {
        const filters: SQL[] = [];
        if (createdSince !== undefined) filters.push(gte(q.sessions.createdAt, createdSince));
        if (agent !== undefined) filters.push(eq(q.sessions.agent, agent));
        const select = db.select().from(q.sessions);
        return filters.length > 0 ? await select.where(and(...filters)).all() : await select.all();
      })
      .andThen((rows) =>
        ResultAsync.fromSafePromise(Promise.all(rows.map((r) => toListSessionsEntry(deps, r)))),
      )
      .map((views) => {
        const survivors = views.filter((v): v is ListSessionsResponse[number] => v !== null);
        const filtered =
          activeSince === undefined
            ? survivors
            : survivors.filter((s) =>
                s.lastActiveAt !== null
                  ? s.lastActiveAt >= activeSince
                  : s.createdAt >= activeSince,
              );
        filtered.sort(compareByActivity);
        return filtered;
      });
  }
}

async function toListSessionsEntry(
  deps: ListSessionsDeps,
  row: SessionRow,
): Promise<ListSessionsResponse[number] | null> {
  const resolved = deps.runtimeRegistry.get(row.runtime);
  if (resolved.isErr()) return null;
  const id = row.id as SessionId;
  const base = {
    id,
    workdir: deps.sandbox.resolve(id),
    agent: row.agent,
    runtime: row.runtime,
    runtimeSessionId: row.runtimeSessionId,
    createdAt: row.createdAt,
    lastActiveAt: null,
    preview: null,
    lastLaunchMode: row.lastLaunchMode,
  };
  if (row.runtimeSessionId === null) return base;
  const meta = await resolved.value.readMetadata(row.runtimeSessionId).unwrapOr(null);
  if (meta === null) return base;
  return {
    ...base,
    lastActiveAt: meta.lastActiveAt ?? base.lastActiveAt,
    preview: meta.title ?? base.preview,
  };
}

/** Never-active rows (null) sort first; the rest by most-recent activity. */
function compareByActivity(
  a: ListSessionsResponse[number],
  b: ListSessionsResponse[number],
): number {
  const aNull = a.lastActiveAt === null;
  const bNull = b.lastActiveAt === null;
  if (aNull !== bNull) return aNull ? -1 : 1;
  if (aNull && bNull) {
    const d = b.createdAt.localeCompare(a.createdAt);
    return d !== 0 ? d : b.id.localeCompare(a.id);
  }
  const d = (b.lastActiveAt as string).localeCompare(a.lastActiveAt as string);
  return d !== 0 ? d : b.id.localeCompare(a.id);
}
