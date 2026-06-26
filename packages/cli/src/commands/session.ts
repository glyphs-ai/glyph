/**
 * `glyph session …` — 5 subcommands wrapping the workspace-scoped
 * sessions HTTP surface (list / new / show / rm / spawn).
 *
 * All commands take `--workspace-id <id>` or read `GLYPH_WORKSPACE`
 * (no server-side fallback — see `connect.ts:resolveWorkspace`).
 * Identifier flags are positional where unambiguous.
 *
 * These routes nest under `/api/workspaces/{id}/…`. The `@glyphs-ai/sdk`
 * generated operations for them omit the middleware-injected `{id}` path
 * param (see `sdk-client.ts`), so we consume the SDK's typed low-level
 * `client.<method>` instead, passing the full `path` map — same fetch /
 * serialization pipeline, correct URL, response typing from the generated
 * `*Responses` maps.
 */

import type {
  GetApiWorkspacesByIdSessionsBySidResponses,
  GetApiWorkspacesByIdSessionsResponses,
  PostApiWorkspacesByIdSessionsBySidSpawnResponses,
  PostApiWorkspacesByIdSessionsResponses,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../output.js";
import type { WorkspaceFlagOpts } from "../registrars/_shared.js";
import type { CommandResult } from "../result.js";
import { unwrap } from "../sdk-client.js";

// ─── list ──────────────────────────────────────────────────────────────
export interface SessionListOpts extends WorkspaceFlagOpts {
  readonly agent?: string;
  readonly createdSince?: string;
  readonly activeSince?: string;
}

export async function sessionList(opts: SessionListOpts = {}): Promise<CommandResult> {
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { agent?: string; createdSince?: string; activeSince?: string } = {};
    if (opts.agent !== undefined) query.agent = opts.agent;
    if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
    if (opts.activeSince !== undefined) query.activeSince = opts.activeSince;
    const list = unwrap(
      await client.get<GetApiWorkspacesByIdSessionsResponses>({
        url: "/api/workspaces/{id}/sessions",
        path: { id: workspaceId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "agent", "runtime", "createdAt"],
        list.map((s) => [
          (s as { id?: string }).id ?? "",
          (s as { agent?: string }).agent ?? "",
          (s as { runtime?: string }).runtime ?? "",
          (s as { createdAt?: string }).createdAt ?? "",
        ]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// ─── new ───────────────────────────────────────────────────────────────
export interface SessionNewOpts extends WorkspaceFlagOpts {
  readonly agent: string;
  readonly runtime?: string;
}

export async function sessionNew(opts: SessionNewOpts): Promise<CommandResult> {
  if (typeof opts.agent !== "string" || opts.agent.trim() === "") {
    return { exitCode: 2, stderr: "missing required --agent <name>\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: { agent: string; runtime?: string } = { agent: opts.agent };
    if (opts.runtime !== undefined) body.runtime = opts.runtime;
    const session = unwrap(
      await client.post<PostApiWorkspacesByIdSessionsResponses>({
        url: "/api/workspaces/{id}/sessions",
        path: { id: workspaceId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(session) : formatRecord({ ...session });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── show ──────────────────────────────────────────────────────────────
export type SessionShowOpts = WorkspaceFlagOpts;

export async function sessionShow(
  sessionId: string,
  opts: SessionShowOpts = {},
): Promise<CommandResult> {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return { exitCode: 2, stderr: "session id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const session = unwrap(
      await client.get<GetApiWorkspacesByIdSessionsBySidResponses>({
        url: "/api/workspaces/{id}/sessions/{sid}",
        path: { id: workspaceId, sid: sessionId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(session) : formatRecord({ ...session });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── rm ────────────────────────────────────────────────────────────────
export interface SessionRmOpts extends WorkspaceFlagOpts {
  readonly purge?: boolean;
}

export async function sessionRm(
  sessionId: string,
  opts: SessionRmOpts = {},
): Promise<CommandResult> {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return { exitCode: 2, stderr: "session id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { purge?: "1" } = {};
    if (opts.purge) query.purge = "1";
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 404 must surface, not be swallowed).
    unwrap(
      await client.delete({
        url: "/api/workspaces/{id}/sessions/{sid}",
        path: { id: workspaceId, sid: sessionId },
        query,
      }),
    );
    return { exitCode: 0, stdout: `session ${sessionId} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── spawn ─────────────────────────────────────────────────────────────
export interface SessionSpawnOpts extends WorkspaceFlagOpts {
  readonly remote?: boolean;
}

export async function sessionSpawn(
  sessionId: string,
  opts: SessionSpawnOpts = {},
): Promise<CommandResult> {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return { exitCode: 2, stderr: "session id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: { remote?: boolean } = {};
    if (opts.remote) body.remote = true;
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdSessionsBySidSpawnResponses>({
        url: "/api/workspaces/{id}/sessions/{sid}/spawn",
        path: { id: workspaceId, sid: sessionId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    if (result.ok) {
      return {
        exitCode: 0,
        stdout: `spawned via ${result.launcher}\n${result.display}\n`,
      };
    }
    // ok=false: terminal spawn failed but the launch command is still
    // useful — print it so the user can copy/paste.
    return {
      exitCode: 0,
      stdout: `spawn failed (${result.code}: ${result.error})\nrun manually:\n${result.display}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}
