/**
 * Session creation logic — rollback-heavy provisioning path.
 */

import { mkdir } from "node:fs/promises";
import type { ResolvedAgent } from "@glyphs-ai/runtime";
import { AgentNotFoundError, AgentResolutionFailedError } from "../errors.js";
import type { CreateSessionOpts, Session } from "../types.js";
import { generateSessionId } from "../validate.js";
import type { SessionServiceCtx } from "./_helpers.js";
import { safeJoinUnderRoot, safeRm } from "./_helpers.js";

const DEFAULT_RUNTIME = "copilot";

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

  // Allocate the per-session workdir.
  //
  // Source of truth for id uniqueness is the `sessions.id` PRIMARY KEY
  // — the disk dir is a "workspace attachment" for the row, not the
  // gatekeeper. Generation is `YYYYMMDD-<4-hex>` so collisions are
  // possible but vanishingly rare under realistic load; we accept that
  // a collision surfaces as either EEXIST (this mkdir) or a PK
  // constraint (the insert below) and lets the caller retry.
  //
  // `ctx.sessionsDir` is owned and pre-created by
  // @glyphs-ai/workspace's provisioner during workspace `register`,
  // so `{recursive: false}` here surfaces a missing parent as ENOENT
  // (composition bug) rather than silently self-healing.
  const id = generateSessionId(ctx.now, ctx.randomBytes);
  const workdir = safeJoinUnderRoot(ctx.sessionsDir, id);
  await mkdir(workdir, { recursive: false });

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
