/**
 * Launch-command assembly and terminal spawn logic.
 */

import type { LaunchCommand } from "@glyphs-ai/runtime";
import { SessionNotFoundError, SpawnFnNotInjectedError } from "../errors.js";
import type { BuildInteractiveLaunchSessionOpts, SpawnSessionResult } from "../types.js";
import { assertValidSessionId } from "../validate.js";
import { assembleLaunchEnv, type SessionServiceCtx } from "./_helpers.js";
import { loadSession } from "./refresh.js";

/**
 * Build the runtime launch command for an interactive session without
 * starting a process.
 */
export async function buildInteractiveLaunch(
  ctx: SessionServiceCtx,
  id: string,
  opts: BuildInteractiveLaunchSessionOpts = {},
): Promise<LaunchCommand> {
  assertValidSessionId(id);
  const session = await loadSession(ctx, id);
  if (session === null) throw new SessionNotFoundError(id);

  const runtime = ctx.runtimeRegistry.get(session.runtime);
  const launch = await runtime.buildInteractiveLaunch(session.runtimeSessionId, {
    workdir: session.workdir,
    workspaceDir: ctx.workspaceDir,
    ...(opts.remote === true ? { remote: true } : {}),
  });

  const launchWithEnv: LaunchCommand = {
    ...launch,
    env: assembleLaunchEnv(ctx, id, session.workdir, launch.env),
  };

  const desiredMode: "local" | "remote" = opts.remote === true ? "remote" : "local";
  if (session.lastLaunchMode !== desiredMode) {
    try {
      await ctx.repo.update(id, { lastLaunchMode: desiredMode });
    } catch (err) {
      ctx.logger.warn(
        {
          sessionId: id,
          err,
        },
        "sessions: failed to persist lastLaunchMode",
      );
    }
  }

  return launchWithEnv;
}

/**
 * Build the session's interactive launch command then immediately hand
 * it to the injected `spawnFn`. Throws {@link SpawnFnNotInjectedError}
 * when no spawner was supplied at compose time.
 */
export async function spawnInteractive(
  ctx: SessionServiceCtx,
  id: string,
  opts: BuildInteractiveLaunchSessionOpts = {},
): Promise<SpawnSessionResult> {
  if (ctx.spawnFn === undefined) {
    throw new SpawnFnNotInjectedError();
  }
  let launch: LaunchCommand;
  try {
    launch = await buildInteractiveLaunch(ctx, id, {
      ...(opts.remote === true ? { remote: true } : {}),
    });
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof Error && err.name ? err.name : "BuildLaunchError",
      display: "",
    };
  }
  try {
    const result = await ctx.spawnFn(launch);
    return {
      ok: true as const,
      launcher: result.launcher,
      display: launch.display,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof Error && err.name ? err.name : "SpawnError",
      display: launch.display,
    };
  }
}
