/**
 * Resolve where to talk to the server (`baseUrl`) and which workspace to
 * scope workspace-aware commands to (`workspaceId`).
 *
 * Precedence (top wins):
 *  - explicit CLI flags (`--server`, `--workspace-id`)
 *  - environment (`GLYPH_SERVER`, `GLYPH_WORKSPACE`)
 *  - `<GLYPH_HOME>/runtime.json` (host/port from a recent
 *    `glyph start`) — for **connection** only
 *  - hard defaults (`http://127.0.0.1:8787`)
 *
 * The runtime-file fallback covers connection (host/port) so a freshly-
 * started local server is usable without env wiring. Workspace-scoped
 * commands require `--workspace-id` or `GLYPH_WORKSPACE` explicitly.
 */

import { resolveGlyphHome } from "@glyphs-ai/server";
import { readRuntimeFile } from "./runtime-file.js";
import { configureClient, type SdkClient } from "./sdk-client.js";

export interface ConnectFlags {
  /** Override `GLYPH_SERVER`. Trailing slash stripped by the client. */
  readonly server?: string;
  /** Override `GLYPH_HOME` for runtime.json lookup. */
  readonly home?: string;
}

export interface ConnectionInfo {
  readonly baseUrl: string;
}

/** Default base URL when nothing else is configured. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

/**
 * Resolve where to send HTTP requests. Pure async — no side effects
 * beyond reading `runtime.json`. Always returns a `baseUrl`.
 */
export async function resolveConnection(flags: ConnectFlags = {}): Promise<ConnectionInfo> {
  const env = process.env;

  let baseUrl = nonEmpty(flags.server) ?? nonEmpty(env.GLYPH_SERVER);

  if (!baseUrl) {
    const home = resolveGlyphHome(
      flags.home !== undefined ? { ...env, GLYPH_HOME: flags.home } : env,
    );
    let rt: Awaited<ReturnType<typeof readRuntimeFile>> = null;
    try {
      rt = await readRuntimeFile(home);
    } catch {
      // Corrupt runtime.json — treat as absent. The user's flags / env
      // are still honoured; absent both, we fall through to defaults.
    }
    if (rt) {
      const host = rt.host === "0.0.0.0" ? "127.0.0.1" : rt.host;
      baseUrl = `http://${host}:${rt.port}`;
    }
  }

  return {
    baseUrl: baseUrl ?? DEFAULT_BASE_URL,
  };
}

/**
 * Configure the shared `@glyphs-ai/sdk` client for a CLI command and return a
 * {@link SdkClient} handle. Wraps {@link resolveConnection} and
 * {@link configureClient} so each command stays one line.
 *
 * The generated typed SDK operations use the configured shared singleton
 * directly. The handle's `baseUrl` backs the raw SSE stream in
 * `commands/task.ts`.
 */
export async function makeSdkClient(flags: ConnectFlags = {}): Promise<SdkClient> {
  const conn = await resolveConnection(flags);
  return configureClient(conn.baseUrl);
}

export interface WorkspaceFlags extends ConnectFlags {
  /** Workspace id; defaults to `GLYPH_WORKSPACE`. */
  readonly workspaceId?: string;
}

/**
 * Resolve the workspace id for a workspace-scoped command.
 *
 * Order:
 *   1. `--workspace-id <id>` flag
 *   2. `GLYPH_WORKSPACE` env
 *   3. Throws — caller's `formatError` surfaces it.
 *
 * Both sources are PROCESS-LOCAL and therefore race-free:
 * `--workspace-id` is in the call's argv, `GLYPH_WORKSPACE` is in the
 * caller's own environment. No cross-client mutation can change the
 * answer between this resolve and the next request.
 */
export async function resolveWorkspace(flags: WorkspaceFlags): Promise<string> {
  const explicit = nonEmpty(flags.workspaceId) ?? nonEmpty(process.env.GLYPH_WORKSPACE);
  if (explicit) return explicit;
  throw new Error(
    "no workspace selected.\n" +
      "  Pass --workspace-id <id> or set GLYPH_WORKSPACE.\n" +
      "  Run `glyph workspace list` to see available ids.",
  );
}

function nonEmpty(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const trimmed = s.trim();
  return trimmed === "" ? undefined : trimmed;
}
