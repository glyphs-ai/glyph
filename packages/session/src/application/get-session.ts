import type { RuntimeRegistry } from "@glyphs-ai/runtime-v2";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { SessionIdSchema } from "../domain/session-id.js";
import type { DatabaseUnavailable, SessionRepository } from "../domain/session-repository.js";
import type { SessionSandbox } from "../domain/session-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetSessionRequestSchema = z.object({ id: SessionIdSchema }).strict();
export type GetSessionRequest = z.infer<typeof GetSessionRequestSchema>;

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

export const GetSessionResponseSchema = SessionViewSchema.nullable();
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

export type GetSessionError = DatabaseUnavailable;

export interface GetSessionDeps {
  readonly repo: SessionRepository;
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
    return deps.repo.findById(id).andThen((entity) => {
      if (entity === undefined) return okAsync<SessionView | null>(null);
      const resolved = deps.runtimeRegistry.get(entity.runtime);
      if (resolved.isErr()) return okAsync<SessionView | null>(null);
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
      if (entity.runtimeSessionId === null) return okAsync<SessionView | null>(base);
      return resolved.value.readMetadata(entity.runtimeSessionId).map((meta): SessionView | null =>
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
