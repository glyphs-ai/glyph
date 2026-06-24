/**
 * Session creation logic — rollback-heavy provisioning path.
 */

import { mkdir } from "node:fs/promises";
import type { ResolvedAgent } from "@glyphs-ai/runtime";
import {
  AgentNotFoundError,
  AgentResolutionFailedError,
  SessionIdAllocationFailedError,
} from "../errors.js";
import type { CreateSessionOpts, Session } from "../types.js";
import { generateSessionId } from "../validate.js";
import type { SessionServiceCtx } from "./_helpers.js";
import { safeJoinUnderRoot, safeRm } from "./_helpers.js";

const DEFAULT_RUNTIME = "copilot";
const MAX_CREATE_RETRIES = 5;

export async function createSession(
  ctx: SessionServiceCtx,
  opts: CreateSessionOpts,
): Promise<Session> {
  const agentName = opts.agent;
  if (typeof agentName !== "string" || agentName.length === 0) {
    throw new AgentNotFoundError(String(agentName));
  }

  const entry = await ctx.agentResolver.getAgentEntry(agentName);
  if (entry === null) {
    throw new AgentNotFoundError(agentName);
  }
  let resolveResult: ResolvedAgent;
  try {
    resolveResult = await ctx.agentResolver.resolveAgent(agentName);
  } catch (err) {
    throw new AgentResolutionFailedError(agentName, err);
  }

  const runtimeKind = opts.runtime ?? DEFAULT_RUNTIME;
  const runtime = ctx.runtimeRegistry.get(runtimeKind);

  await mkdir(ctx.sessionsDir, { recursive: true });
  let id: string | null = null;
  let workdir: string | null = null;
  for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
    const candidateId = generateSessionId(ctx.now, ctx.randomBytes);
    const candidateDir = safeJoinUnderRoot(ctx.sessionsDir, candidateId);
    try {
      await mkdir(candidateDir, { recursive: false });
      id = candidateId;
      workdir = candidateDir;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue;
      throw err;
    }
  }
  if (id === null || workdir === null) {
    throw new SessionIdAllocationFailedError(MAX_CREATE_RETRIES);
  }

  let provisionedRuntimeSessionId: string | null = null;
  try {
    const { runtimeSessionId } = await runtime.provision({
      workdir,
      agent: resolveResult,
      catalog: ctx.contentSource,
      workspaceDir: ctx.workspaceDir,
    });
    provisionedRuntimeSessionId = runtimeSessionId;
    const createdAt = ctx.now().toISOString();
    const canonicalAgent = resolveResult.agent.fqn;
    await ctx.repo.insert({
      id,
      agent: canonicalAgent,
      runtime: runtime.kind,
      createdAt,
      runtimeSessionId,
    });
    return {
      id,
      workdir,
      agent: canonicalAgent,
      runtime: runtime.kind,
      runtimeSessionId,
      createdAt,
      lastActiveAt: null,
      preview: null,
      lastLaunchMode: null,
    };
  } catch (err) {
    await safeRm(workdir, ctx.logger);
    if (provisionedRuntimeSessionId !== null) {
      try {
        await runtime.deleteState(provisionedRuntimeSessionId);
      } catch (cleanupErr) {
        ctx.logger.warn(
          {
            sessionId: id,
            runtimeSessionId: provisionedRuntimeSessionId,
            err: cleanupErr,
          },
          "session create: runtime state cleanup failed during rollback",
        );
      }
    }
    throw err;
  }
}
