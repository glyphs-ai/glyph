/**
 * Session refresh and projection internals — `draftFromEntity`,
 * `refreshSession`, `loadSession`.
 */

import type { Runtime } from "@glyphs-ai/runtime";
import { safeJoinUnderRoot } from "../paths.js";
import type { SessionEntity } from "../session-entity.js";
import type { Session } from "../types.js";
import type { SessionServiceCtx } from "./_helpers.js";

export async function draftFromEntity(
  ctx: SessionServiceCtx,
  entity: SessionEntity,
): Promise<Session | null> {
  const workdir = safeJoinUnderRoot(ctx.sessionsDir, entity.id);

  try {
    ctx.runtimeRegistry.get(entity.runtime);
  } catch (err) {
    ctx.logger.warn(
      {
        sessionId: entity.id,
        runtime: entity.runtime,
        err,
      },
      "sessions: skipping session with unregistered runtime",
    );
    return null;
  }

  return {
    id: entity.id,
    workdir,
    agent: entity.agent,
    runtime: entity.runtime,
    runtimeSessionId: entity.runtimeSessionId,
    createdAt: entity.createdAt,
    lastActiveAt: null,
    preview: null,
    lastLaunchMode: entity.lastLaunchMode,
  };
}

export async function refreshSession(ctx: SessionServiceCtx, draft: Session): Promise<Session> {
  const runtime = ctx.runtimeRegistry.get(draft.runtime);
  if (typeof runtime.readMetadata !== "function" || draft.runtimeSessionId === null) {
    return draft;
  }

  let refreshed: Awaited<ReturnType<NonNullable<Runtime["readMetadata"]>>>;
  try {
    refreshed = await runtime.readMetadata(draft.runtimeSessionId);
  } catch (err) {
    ctx.logger.warn(
      {
        sessionId: draft.id,
        runtime: draft.runtime,
        err,
      },
      "sessions: runtime readMetadata failed",
    );
    return draft;
  }
  if (refreshed === null) {
    return draft;
  }

  return {
    ...draft,
    lastActiveAt: refreshed.lastActiveAt ?? draft.lastActiveAt,
    preview: refreshed.title ?? draft.preview,
  };
}

export async function loadSession(ctx: SessionServiceCtx, id: string): Promise<Session | null> {
  let row: SessionEntity | undefined;
  try {
    row = await ctx.repo.findById(id);
  } catch (err) {
    ctx.logger.warn(
      {
        sessionId: id,
        err,
      },
      "sessions: repository.read failed",
    );
    return null;
  }
  if (row === undefined) return null;
  const draft = await draftFromEntity(ctx, row);
  if (draft === null) return null;
  return refreshSession(ctx, draft);
}
