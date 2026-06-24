/**
 * Shared utilities for the SPLIT sub-layout of `session-service.ts`.
 * Cross-cutting helpers (`safeRm`, `assembleLaunchEnv`) live here so
 * the sibling concern modules stay focused on their own domain.
 */

import { rm } from "node:fs/promises";
import type { AgentContentSource, RuntimeRegistry } from "@glyphs-ai/runtime";
import type { Logger } from "pino";
import type { AgentResolverPort, SpawnFn } from "../ports.js";
import type { SessionRepository } from "../session-repository.js";

/**
 * Shared state passed by the facade to every internal function. Built
 * once in the constructor and threaded through as the single context
 * argument. Exported for sibling files to import as `type`.
 */
export interface SessionServiceCtx {
  readonly agentResolver: AgentResolverPort;
  readonly contentSource: AgentContentSource;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sessionsDir: string;
  readonly workspaceDir: string;
  readonly workspaceId: string;
  readonly repo: SessionRepository;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly randomBytes: (n: number) => Buffer;
  readonly spawnFn: SpawnFn | undefined;
}

/** Best-effort directory removal. Failures are logged, not thrown. */
export async function safeRm(p: string, logger: Logger): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      {
        path: p,
        err,
      },
      "sessions: failed to remove workdir during cleanup",
    );
  }
}

/**
 * Build the env bag layered onto the LaunchCommand returned by the
 * runtime. The runtime owns cross-cutting env; we layer session-context
 * env on top.
 *
 * Order (later wins on key collision):
 *   1. Runtime-supplied env (from `launch.env`)
 *   2. Per-session: GLYPH_WORKSPACE / GLYPH_WORKSPACE_DIR / GLYPH_WORK_*
 */
export function assembleLaunchEnv(
  ctx: SessionServiceCtx,
  sessionId: string,
  sessionWorkdir: string,
  runtimeEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (runtimeEnv !== undefined) {
    for (const [k, v] of Object.entries(runtimeEnv)) {
      out[k] = v;
    }
  }
  out.GLYPH_WORKSPACE = ctx.workspaceId;
  out.GLYPH_WORKSPACE_DIR = ctx.workspaceDir;
  out.GLYPH_WORK_KIND = "session";
  out.GLYPH_WORK_ID = sessionId;
  out.GLYPH_WORK_DIR = sessionWorkdir;
  return out;
}
