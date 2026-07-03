import type {
  PostApiWorkspacesByIdSessionsBySidSpawnResponses,
  PostApiWorkspacesByIdSessionsResponses,
} from "@glyphs-ai/sdk";
import {
  client,
  deleteApiWorkspacesByIdSessionsBySid,
  getApiWorkspacesByIdSessions,
  getApiWorkspacesByIdSessionsBySid,
} from "@glyphs-ai/sdk";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";

export interface SessionView {
  id: string;
  workdir: string;
  agent: string;
  /** Runtime kind (e.g. "copilot"). */
  runtime: string;
  /** Native session ID assigned by the runtime, or null if not yet known. */
  runtimeSessionId: string | null;
  /** ISO 8601 string. */
  createdAt: string;
  /** ISO 8601 string of the runtime's last observed activity, or null. */
  lastActiveAt: string | null;
  /** Short human-readable preview from the runtime, or null. */
  preview: string | null;
  /**
   * Mode the user chose for the most recent successful launch of this
   * session, or null if it has never been launched. Drives the default
   * action of the Resume split button.
   */
  lastLaunchMode: "local" | "remote" | null;
}

export interface LaunchCommand {
  cmd: string;
  args: string[];
  cwd: string;
  display: string;
}

export interface ListSessionsOpts {
  agent?: string;
  /** ISO 8601 timestamp; sessions created before this are excluded server-side. */
  createdSince?: string;
  /**
   * ISO 8601 timestamp; sessions whose lastActiveAt is before this (or
   * null) are excluded server-side. More expensive than createdSince
   * because the server must call runtime.refresh() before filtering.
   */
  activeSince?: string;
}

export const listSessions = async (opts: ListSessionsOpts = {}): Promise<SessionView[]> => {
  const query: { agent?: string; createdSince?: string; activeSince?: string } = {};
  if (opts.agent) query.agent = opts.agent;
  if (opts.createdSince) query.createdSince = opts.createdSince;
  if (opts.activeSince) query.activeSince = opts.activeSince;
  return unwrap(await getApiWorkspacesByIdSessions({ path: { id: requireWorkspaceId() }, query }));
};

export const getSession = async (sessionId: string): Promise<SessionView> => {
  const session = unwrap(
    await getApiWorkspacesByIdSessionsBySid({
      path: { id: requireWorkspaceId(), sid: sessionId },
    }),
  );
  // The route 404s on a missing session, so a 200 body is never null;
  // this guards the nullable wire type the OpenAPI now declares.
  if (session === null) throw new Error(`session ${sessionId} not found`);
  return session;
};

export interface CreateSessionOpts {
  agent: string;
  runtime?: string;
}

export const createSession = async (opts: CreateSessionOpts): Promise<SessionView> => {
  const { agent, runtime } = opts;
  const body: { agent: string; runtime?: string } = { agent };
  if (runtime !== undefined) body.runtime = runtime;
  return unwrap(
    await client.post<PostApiWorkspacesByIdSessionsResponses>({
      url: "/api/workspaces/{id}/sessions",
      path: { id: requireWorkspaceId() },
      body,
    }),
  );
};

export const deleteSession = async (
  sessionId: string,
  opts?: { purge?: boolean },
): Promise<void> => {
  // Default ("archive") removes only the session metadata row — workdir
  // contents (AGENTS.md + agent-produced files) and the runtime
  // adapter's per-session state both stay on disk so the user can
  // recover or inspect them later. `{ purge: true }` is the hard-delete
  // path: row + workdir + runtime state, all gone. The confirm modal
  // exposes this as a single checkbox.
  const query: { purge?: "1" } = {};
  if (opts?.purge) query.purge = "1";
  unwrap(
    await deleteApiWorkspacesByIdSessionsBySid({
      path: { id: requireWorkspaceId(), sid: sessionId },
      query,
    }),
  );
};

export interface SpawnSuccess {
  ok: true;
  launcher: string;
  display: string;
}

export interface SpawnFailure {
  ok: false;
  error: string;
  code?: string;
  display: string;
}

export type SpawnResult = SpawnSuccess | SpawnFailure;

export const spawnSession = async (
  sessionId: string,
  opts: { remote?: boolean } = {},
): Promise<SpawnResult> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdSessionsBySidSpawnResponses>({
      url: "/api/workspaces/{id}/sessions/{sid}/spawn",
      path: { id: requireWorkspaceId(), sid: sessionId },
      body: opts.remote === true ? { remote: true } : {},
    }),
  );
