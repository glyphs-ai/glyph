import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { SessionEntity } from "../domain/session-entity.js";
import { SessionIdSchema } from "../domain/session-id.js";
import type { DatabaseUnavailable, SessionRepository } from "../domain/session-repository.js";
import type { SessionSandbox } from "../domain/session-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListSessionsRequestSchema = z
  .object({
    agent: z.string().optional(),
    createdSince: z.string().optional(),
    activeSince: z.string().optional(),
  })
  .strict();
export type ListSessionsRequest = z.infer<typeof ListSessionsRequestSchema>;

const SessionViewSchema = z.object({
  id: SessionIdSchema,
  workdir: z.string(),
  agent: z.string(),
  runtime: z.string(),
  runtimeSessionId: z.string().nullable(),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
  preview: z.string().nullable(),
  lastLaunchMode: z.enum(["local", "remote"]).nullable(),
});
type SessionView = z.infer<typeof SessionViewSchema>;

export const ListSessionsResponseSchema = z.array(SessionViewSchema);
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export type ListSessionsError = DatabaseUnavailable;

export interface ListSessionsDeps {
  readonly repo: SessionRepository;
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
    return deps.repo
      .findAll({
        ...(createdSince !== undefined ? { createdSince } : {}),
        ...(agent !== undefined ? { agent } : {}),
      })
      .andThen((entities) =>
        ResultAsync.fromSafePromise(Promise.all(entities.map((e) => projectAndRefresh(deps, e)))),
      )
      .map((views) => {
        const survivors = views.filter((v): v is SessionView => v !== null);
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

async function projectAndRefresh(
  deps: ListSessionsDeps,
  entity: SessionEntity,
): Promise<SessionView | null> {
  const resolved = deps.runtimeRegistry.get(entity.runtime);
  if (resolved.isErr()) return null;
  const base: SessionView = {
    id: entity.id,
    workdir: deps.sandbox.resolve(entity.id),
    agent: entity.agent,
    runtime: entity.runtime,
    runtimeSessionId: entity.runtimeSessionId,
    createdAt: entity.createdAt,
    lastActiveAt: null,
    preview: null,
    lastLaunchMode: entity.lastLaunchMode,
  };
  if (entity.runtimeSessionId === null) return base;
  const meta = await resolved.value.readMetadata(entity.runtimeSessionId).unwrapOr(null);
  if (meta === null) return base;
  return {
    ...base,
    lastActiveAt: meta.lastActiveAt ?? base.lastActiveAt,
    preview: meta.title ?? base.preview,
  };
}

/** Most-recent activity first; never-active rows (null) sort to the bottom. */
function compareByActivity(a: SessionView, b: SessionView): number {
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
