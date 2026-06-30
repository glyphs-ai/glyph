import type {
  LaunchCommand,
  RuntimeLaunchFailed,
  RuntimeRegistry,
  UnknownRuntime,
} from "@glyphs-ai/runtime-v2";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { type SessionId, SessionIdSchema } from "../domain/session-id.js";
import type {
  DatabaseUnavailable,
  SessionNotFound,
  SessionRepository,
} from "../domain/session-repository.js";
import type { SessionSandbox } from "../domain/session-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const BuildInteractiveLaunchRequestSchema = z
  .object({ id: SessionIdSchema, remote: z.boolean().optional() })
  .strict();
export type BuildInteractiveLaunchRequest = z.infer<typeof BuildInteractiveLaunchRequestSchema>;

/** Response is the runtime's `LaunchCommand` (a runtime data type, passed through). */
export type BuildInteractiveLaunchResponse = LaunchCommand;

export type BuildInteractiveLaunchError =
  | SessionNotFound
  | UnknownRuntime
  | RuntimeLaunchFailed
  | DatabaseUnavailable;

export interface BuildInteractiveLaunchDeps {
  readonly repo: SessionRepository;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: SessionSandbox;
  readonly workspaceId: string;
  readonly workspaceDir: string;
}

/**
 * Assemble the runtime launch command for an interactive session
 * (without spawning a process) and layer session-context env on top.
 * The desired launch mode is persisted best-effort.
 */
export class BuildInteractiveLaunchUseCase
  implements
    UseCase<
      BuildInteractiveLaunchRequest,
      BuildInteractiveLaunchResponse,
      BuildInteractiveLaunchError
    >
{
  constructor(private readonly deps: BuildInteractiveLaunchDeps) {}

  execute(
    request: BuildInteractiveLaunchRequest,
  ): UseCaseResult<BuildInteractiveLaunchResponse, BuildInteractiveLaunchError> {
    const { id, remote } = BuildInteractiveLaunchRequestSchema.parse(request);
    const deps = this.deps;
    const desiredMode: "local" | "remote" = remote === true ? "remote" : "local";
    return deps.repo.get(id).andThen((entity) =>
      deps.runtimeRegistry.get(entity.runtime).asyncAndThen((rt) => {
        const workdir = deps.sandbox.resolve(id);
        return rt
          .buildInteractiveLaunch(entity.runtimeSessionId, {
            workdir,
            workspaceDir: deps.workspaceDir,
            ...(remote === true ? { remote: true } : {}),
          })
          .andThen((launch) => {
            const launchWithEnv: LaunchCommand = {
              ...launch,
              env: assembleEnv(deps, id, workdir, launch.env),
            };
            if (entity.lastLaunchMode === desiredMode) return okAsync(launchWithEnv);
            entity.markLaunched(desiredMode);
            return deps.repo
              .save(entity)
              .map(() => launchWithEnv)
              .orElse(() => okAsync(launchWithEnv));
          });
      }),
    );
  }
}

function assembleEnv(
  deps: BuildInteractiveLaunchDeps,
  sessionId: SessionId,
  workdir: string,
  runtimeEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (runtimeEnv !== undefined) for (const [k, v] of Object.entries(runtimeEnv)) out[k] = v;
  out.GLYPH_WORKSPACE = deps.workspaceId;
  out.GLYPH_WORKSPACE_DIR = deps.workspaceDir;
  out.GLYPH_WORK_KIND = "session";
  out.GLYPH_WORK_ID = sessionId;
  out.GLYPH_WORK_DIR = workdir;
  return out;
}
