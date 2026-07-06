import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { eq } from "drizzle-orm";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { SessionIdSchema } from "../domain/session-id.js";
import type { DatabaseUnavailable } from "../domain/session-repository.js";
import type { SessionSandbox } from "../domain/session-sandbox.js";
import type { SessionQueries } from "../infrastructure/drizzle/session-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetSessionRequestSchema = z.object({ id: SessionIdSchema }).strict();
export type GetSessionRequest = z.infer<typeof GetSessionRequestSchema>;

export const GetSessionResponseSchema = z
  .object({
    id: SessionIdSchema,
    workdir: z.string(),
    agent: z.string(),
    runtime: z.string(),
    runtimeSessionId: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string().nullable(),
    preview: z.string().nullable(),
    lastLaunchMode: z.enum(["local", "remote"]).nullable(),
  })
  .nullable();
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

export type GetSessionError = DatabaseUnavailable;

export interface GetSessionDeps {
  readonly query: SessionQueries;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: SessionSandbox;
}

/**
 * Read one session by id; `null` when absent or when its runtime is no
 * longer registered. Live `lastActiveAt` / `preview` are refreshed from
 * the runtime (best-effort).
 */
export class GetSessionUseCase
  implements UseCase<GetSessionRequest, GetSessionResponse, GetSessionError>
{
  constructor(private readonly deps: GetSessionDeps) {}

  execute(request: GetSessionRequest): UseCaseResult<GetSessionResponse, GetSessionError> {
    const { id } = GetSessionRequestSchema.parse(request);
    const deps = this.deps;
    const q = deps.query;
    return q
      .query((db) => db.select().from(q.sessions).where(eq(q.sessions.id, id)).get())
      .andThen((row) => {
        if (row === undefined) return okAsync<GetSessionResponse>(null);
        const resolved = deps.runtimeRegistry.get(row.runtime);
        if (resolved.isErr()) return okAsync<GetSessionResponse>(null);
        const base = {
          id: id,
          workdir: deps.sandbox.resolve(id),
          agent: row.agent,
          runtime: row.runtime,
          runtimeSessionId: row.runtimeSessionId,
          createdAt: row.createdAt,
          lastActiveAt: null,
          preview: null,
          lastLaunchMode: row.lastLaunchMode,
        };
        if (row.runtimeSessionId === null) return okAsync<GetSessionResponse>(base);
        return resolved.value.readMetadata(row.runtimeSessionId).map(
          (meta): GetSessionResponse =>
            meta === null
              ? base
              : {
                  ...base,
                  lastActiveAt: meta.lastActiveAt ?? base.lastActiveAt,
                  preview: meta.title ?? base.preview,
                },
        );
      });
  }
}
