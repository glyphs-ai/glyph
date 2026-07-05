import type { Spawner } from "@glyphs-ai/terminal";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { SessionIdSchema } from "../domain/session-id.js";
import type {
  BuildInteractiveLaunchError,
  BuildInteractiveLaunchUseCase,
} from "./build-interactive-launch.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const SpawnInteractiveRequestSchema = z
  .object({ id: SessionIdSchema, remote: z.boolean().optional() })
  .strict();
export type SpawnInteractiveRequest = z.infer<typeof SpawnInteractiveRequestSchema>;

export const SpawnInteractiveResponseSchema = z.union([
  z.object({ ok: z.literal(true), launcher: z.string(), display: z.string() }),
  z.object({ ok: z.literal(false), error: z.string(), code: z.string(), display: z.string() }),
]);
export type SpawnInteractiveResponse = z.infer<typeof SpawnInteractiveResponseSchema>;

/** Build + spawn failures are folded into the result; never fails. */
export type SpawnInteractiveError = never;

export interface SpawnInteractiveDeps {
  readonly buildInteractiveLaunch: BuildInteractiveLaunchUseCase;
  readonly spawner: Spawner;
}

/**
 * Build the session's interactive launch then hand it to the spawner.
 * The `display` field is always populated so a copy-paste fallback is
 * available even when the spawn fails.
 */
export class SpawnInteractiveUseCase
  implements UseCase<SpawnInteractiveRequest, SpawnInteractiveResponse, SpawnInteractiveError>
{
  constructor(private readonly deps: SpawnInteractiveDeps) {}

  execute(
    request: SpawnInteractiveRequest,
  ): UseCaseResult<SpawnInteractiveResponse, SpawnInteractiveError> {
    const { id, remote } = SpawnInteractiveRequestSchema.parse(request);
    const deps = this.deps;
    return deps.buildInteractiveLaunch
      .execute({ id, ...(remote === true ? { remote: true } : {}) })
      .andThen((launch) =>
        deps.spawner
          .spawn(launch)
          .map(
            (result): SpawnInteractiveResponse => ({
              ok: true,
              launcher: result.launcher,
              display: launch.display,
            }),
          )
          .orElse((e) =>
            okAsync<SpawnInteractiveResponse>({
              ok: false,
              error: e.message,
              code: e.code,
              display: launch.display,
            }),
          ),
      )
      .orElse((e) =>
        okAsync<SpawnInteractiveResponse>({
          ok: false,
          error: describeLaunchError(e),
          code: e.type,
          display: "",
        }),
      );
  }
}

function describeLaunchError(e: BuildInteractiveLaunchError): string {
  switch (e.type) {
    case "SessionNotFound":
      return `session not found: ${e.id}`;
    case "UnknownRuntime":
      return `unknown runtime: ${e.runtime}`;
    case "RuntimeLaunchFailed":
      return "runtime failed to build the interactive launch";
    case "DatabaseUnavailable":
      return "session store unavailable";
  }
}
