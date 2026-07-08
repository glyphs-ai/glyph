import { rm } from "node:fs/promises";
import path from "node:path";
import { type Application, composeApplication } from "@glyphs-ai/api";
import { CopilotRuntime, InMemoryRuntimeRegistry, type RuntimeRegistry } from "@glyphs-ai/runtime";
import type { WorkspaceModule, WorkspaceName } from "@glyphs-ai/workspace";
import type { Logger } from "pino";

/**
 * Shared scaffolding for server-side tests. Builds the full `Application`
 * composition root around an in-memory workspace registry.
 */
export interface ServerTestSubsystem {
  readonly application: Application;
  readonly workspace: WorkspaceModule;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly defaultWorkspaceParent: string;
  /** Close the workspace registry's sqlite connection and every per-workspace context. */
  close(): Promise<void>;
}

export async function setupTestSubsystem(opts: {
  readonly scratch: string;
  readonly logger?: Logger;
}): Promise<ServerTestSubsystem> {
  const runtimeRegistry = new InMemoryRuntimeRegistry();
  runtimeRegistry.register(
    new CopilotRuntime({ copilotConfigPath: path.join(opts.scratch, "copilot-config.json") }),
  );
  const defaultWorkspaceParent = path.join(opts.scratch, "default-workspaces");
  const composition = await composeApplication({
    workspace: { dbUrl: ":memory:", defaultWorkspaceParent },
    runtimeRegistry,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  return {
    application: composition,
    workspace: composition.workspace,
    runtimeRegistry,
    defaultWorkspaceParent,
    async close() {
      await composition.close();
    },
  };
}

export async function teardownTestSubsystem(sys: ServerTestSubsystem): Promise<void> {
  try {
    // `application.close()` closes the internal per-workspace context
    // registry first, then the global registry handle. Idempotent.
    await sys.close();
  } catch {
    // best-effort
  }
}

export async function registerTestWorkspace(
  sys: ServerTestSubsystem,
  args: { readonly workspaceDir: string; readonly name: string },
): Promise<string> {
  const result = await sys.workspace.registerWorkspace.execute({
    workspaceDir: args.workspaceDir,
    name: args.name as WorkspaceName,
  });
  if (result.isErr()) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/**
 * Windows-safe scratch cleanup. libsql closes its libuv fd asynchronously
 * and the Windows kernel keeps an exclusive lock on `workspace.db-wal` /
 * `workspace.db-shm` for a while after `client.close()` returns, so `rm`
 * sees EBUSY. Two rules make this robust:
 *
 *   1. BOUNDED retry budget. Node's `rm` uses *linear* backoff — attempt
 *      n waits `retryDelay * n`, so the cumulative wait is
 *      `retryDelay * maxRetries * (maxRetries + 1) / 2`. A large count
 *      (e.g. 30 * 300ms ≈ 139s) silently exceeds the hookTimeout and
 *      hangs the whole suite. Keep the budget small (~11s here).
 *   2. BEST-EFFORT. Cleanup is hygiene, not an assertion. If the WAL lock
 *      outlives the budget, swallow the error: a leaked temp dir under
 *      os.tmpdir() is harmless in CI (the OS reaps it, and the next test
 *      mkdtemps a fresh dir) and must never fail the teardown hook.
 */
export async function rmScratch(scratch: string): Promise<void> {
  // Let libuv/libsql drain and the Windows lock manager release the WAL fd.
  await new Promise((r) => setTimeout(r, 500));
  try {
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    // best-effort — WAL lock outlived the retry budget; leak and move on.
  }
}
