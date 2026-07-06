import type {
  AgentContentSource,
  RuntimeProvisionFailed,
  RuntimeRegistry,
  UnknownRuntime,
} from "@glyphs-ai/runtime";
import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";
import { SessionEntity } from "../domain/session-entity.js";
import { type SessionId, SessionIdSchema } from "../domain/session-id.js";
import type { DatabaseUnavailable, SessionRepository } from "../domain/session-repository.js";
import type { SandboxProvisionFailed, SessionSandbox } from "../domain/session-sandbox.js";
import type { AgentNotFound, AgentResolver, AgentUnresolvable } from "./ports/agent-resolver.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

const DEFAULT_RUNTIME = "copilot";

/**
 * Mint a fresh session id from the supplied clock + randomness. Both are
 * injected by the use-case (see {@link CreateSessionDeps}) so tests can
 * pin the id; the id is not a precise timestamp (the `createdAt` column
 * carries within-day ordering). The format is owned by `SessionIdSchema`
 * in the domain; this factory produces a value that satisfies it.
 */
export function generateSessionId(now: () => Date, randomBytes: (n: number) => Buffer): SessionId {
  const d = now();
  const date =
    d.getFullYear().toString().padStart(4, "0") +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0");
  const suffix = randomBytes(4).toString("hex");
  return `${date}-${suffix}` as SessionId;
}

export const CreateSessionRequestSchema = z
  .object({ agent: z.string().min(1), runtime: z.string().optional() })
  .strict();
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// Deliberate duplication: this 9-field session projection is intentionally NOT
// shared with the sibling get-session / list-sessions use cases that expose the
// same shape. Each owns its V1 response so a later evolution of one caller never
// drags the others along in lockstep. Redundancy > coupling.
export const CreateSessionResponseSchema = z.object({
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
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export type CreateSessionError =
  | AgentNotFound
  | AgentUnresolvable
  | SandboxProvisionFailed
  | UnknownRuntime
  | RuntimeProvisionFailed
  | DatabaseUnavailable;

export interface CreateSessionDeps {
  readonly repo: SessionRepository;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: SessionSandbox;
  readonly agentResolver: AgentResolver;
  readonly contentSource: AgentContentSource;
  readonly workspaceDir: string;
  readonly now: () => Date;
  readonly randomBytes: (n: number) => Buffer;
}

/**
 * Mint a session: resolve the agent, create the sandbox, provision
 * runtime state, persist the row. Any failure after the sandbox is
 * created rolls back the sandbox (and provisioned runtime state) before
 * surfacing the error.
 */
export class CreateSessionUseCase
  implements UseCase<CreateSessionRequest, CreateSessionResponse, CreateSessionError>
{
  constructor(private readonly deps: CreateSessionDeps) {}

  execute(request: CreateSessionRequest): UseCaseResult<CreateSessionResponse, CreateSessionError> {
    const { agent, runtime } = CreateSessionRequestSchema.parse(request);
    const runtimeKind = runtime ?? DEFAULT_RUNTIME;
    const deps = this.deps;
    const id = generateSessionId(deps.now, deps.randomBytes);

    return safeTry<CreateSessionResponse, CreateSessionError>(async function* () {
      const resolved = yield* deps.agentResolver.resolve(agent);
      const rt = yield* deps.runtimeRegistry.get(runtimeKind);
      const workdir = yield* deps.sandbox.create(id);

      const provisioned = await rt.provision({
        workdir,
        agent: resolved,
        catalog: deps.contentSource,
        workspaceDir: deps.workspaceDir,
      });
      if (provisioned.isErr()) {
        await deps.sandbox.remove(id);
        return err<CreateSessionResponse, CreateSessionError>(provisioned.error);
      }
      const { runtimeSessionId } = provisioned.value;

      const entity = SessionEntity.create({
        id,
        agent: resolved.agent.fqn,
        runtime: runtimeKind,
        runtimeSessionId,
        now: deps.now().toISOString(),
      });
      const inserted = await deps.repo.save(entity);
      if (inserted.isErr()) {
        await deps.sandbox.remove(id);
        if (runtimeSessionId !== null) await rt.deleteState(runtimeSessionId);
        return err<CreateSessionResponse, CreateSessionError>(inserted.error);
      }

      return ok<CreateSessionResponse, CreateSessionError>({
        id: entity.id,
        workdir,
        agent: entity.agent,
        runtime: entity.runtime,
        runtimeSessionId: entity.runtimeSessionId,
        createdAt: entity.createdAt,
        lastActiveAt: null,
        preview: null,
        lastLaunchMode: entity.lastLaunchMode,
      });
    });
  }
}
