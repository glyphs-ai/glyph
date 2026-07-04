import {
  deleteApiWorkspacesById,
  getApiWorkspaces,
  getApiWorkspacesCurrent,
  patchApiWorkspacesById,
  postApiWorkspaces,
  putApiWorkspacesCurrent,
} from "@glyphs-ai/sdk";
import { unwrap } from "./sdk-client.js";

/**
 * A registered workspace, as returned by the `/api/workspaces` family of
 * endpoints. The shape mirrors the server's `Workspace` domain type — flat,
 * no `metadata` wrapper, no `schemaVersion` (that's a Repository-internal
 * concern). `workspaceDir` is the only filesystem path field; everything
 * else is pure metadata that survives a backend swap (FS today, SQLite
 * tomorrow).
 */
export interface WorkspaceListItem {
  /** Opaque UUID; the URL routing key. */
  id: string;
  /** Display name (free-form text, 1-64 trimmed chars). */
  name: string;
  /** ISO 8601 UTC timestamp at creation. */
  createdAt: string;
  /** Absolute filesystem path the workspace lives under. */
  workspaceDir: string;
}

export const listWorkspaces = async (): Promise<WorkspaceListItem[]> =>
  unwrap(await getApiWorkspaces());

export const getServerCurrentWorkspace = async (): Promise<{ id: string | null }> =>
  unwrap(await getApiWorkspacesCurrent());

export const setServerCurrentWorkspace = async (workspaceId: string): Promise<void> => {
  unwrap(await putApiWorkspacesCurrent({ body: { id: workspaceId } }));
};

export const addWorkspace = async (opts: {
  name: string;
  /** Optional. When omitted, the server creates a fresh
   *  `<GLYPH_HOME>/workspaces/<uuid>/` directory. */
  workspaceDir?: string;
}): Promise<WorkspaceListItem> => {
  const body: { name: string; workspaceDir?: string } = { name: opts.name };
  if (opts.workspaceDir !== undefined && opts.workspaceDir !== "")
    body.workspaceDir = opts.workspaceDir;
  return unwrap(await postApiWorkspaces({ body }));
};

/**
 * Remove a workspace from the registry.
 *
 * Metadata-only: the registry row in `global.db` is deleted but the
 * workspace's directory contents (the user's files plus any
 * agent-produced `sessions/`, `tasks/`, `workflows/`) stay on disk.
 */
export const removeWorkspace = async (workspaceId: string): Promise<void> => {
  unwrap(await deleteApiWorkspacesById({ path: { id: workspaceId } }));
};

export const updateWorkspaceMetadata = async (
  workspaceId: string,
  patch: { name: string },
): Promise<WorkspaceListItem> => {
  const updated = unwrap(await patchApiWorkspacesById({ path: { id: workspaceId }, body: patch }));
  // The route 404s on a missing workspace, so a 200 body is never null;
  // this guards the nullable wire type the OpenAPI now declares.
  if (updated === null) throw new Error(`workspace ${workspaceId} not found`);
  return updated;
};
