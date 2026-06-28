/**
 * `glyph workspace …` — subcommands wrapping the workspace HTTP
 * surface (list / add / current / show / update / rm / reload).
 *
 * Every command takes `--server` / `--output` (some also `--json`
 * shorthand). Workspace-scoped flags (`--workspace-id`) live in the
 * family commands (`session`, `schedule`, `task`, `workflow`, `catalog`).
 *
 * Unlike the nested workspace-scoped families, these top-level routes
 * have correct generated `path` types (the `{id}` is declared), so they
 * use the `@glyphs-ai/sdk` generated operations directly.
 */

import {
  deleteApiWorkspacesById,
  getApiWorkspaces,
  getApiWorkspacesById,
  getApiWorkspacesCurrent,
  patchApiWorkspacesById,
  postApiWorkspaces,
  postApiWorkspacesByIdReload,
} from "@glyphs-ai/sdk";
import { makeSdkClient } from "../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../output.js";
import type { ConnectFlagOpts } from "../registrars/_shared.js";
import type { CommandResult } from "../result.js";
import { unwrap } from "../sdk-client.js";

// ─── list ──────────────────────────────────────────────────────────────
export type WorkspaceListOpts = ConnectFlagOpts;

export async function workspaceList(opts: WorkspaceListOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const list = unwrap(await getApiWorkspaces());
    const fmt = pickFormat(opts, "table");
    const stdout =
      fmt === "json"
        ? formatJson(list)
        : formatTable(
            ["id", "name", "workspaceDir", "createdAt"],
            list.map((w) => [w.id, w.name, w.workspaceDir, w.createdAt]),
          );
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── add ───────────────────────────────────────────────────────────────
export interface WorkspaceAddOpts extends ConnectFlagOpts {
  readonly name: string;
  /** Absolute path; server mints `<GLYPH_HOME>/workspaces/<uuid>` when omitted. */
  readonly workspaceDir?: string;
}

export async function workspaceAdd(opts: WorkspaceAddOpts): Promise<CommandResult> {
  if (typeof opts.name !== "string" || opts.name.trim() === "") {
    return { exitCode: 2, stderr: "missing required --name <name>\n" };
  }
  await makeSdkClient(opts);
  try {
    const body = {
      name: opts.name,
      ...(opts.workspaceDir !== undefined ? { workspaceDir: opts.workspaceDir } : {}),
    };
    const ws = unwrap(await postApiWorkspaces({ body }));
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── current ───────────────────────────────────────────────────────────
export type WorkspaceCurrentOpts = ConnectFlagOpts;

export async function workspaceCurrent(opts: WorkspaceCurrentOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const cur = unwrap(await getApiWorkspacesCurrent());
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(cur) };
    return { exitCode: 0, stdout: `${cur.id ?? "(none)"}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── show ──────────────────────────────────────────────────────────────
export type WorkspaceShowOpts = ConnectFlagOpts;

export async function workspaceShow(
  workspaceId: string,
  opts: WorkspaceShowOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const ws = unwrap(await getApiWorkspacesById({ path: { id: workspaceId } }));
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── update ────────────────────────────────────────────────────────────
export interface WorkspaceUpdateOpts extends ConnectFlagOpts {
  readonly name?: string;
}

export async function workspaceUpdate(
  workspaceId: string,
  opts: WorkspaceUpdateOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  // The route requires at least the name patch — mirror the server's
  // check up front so we don't waste a round trip.
  if (opts.name === undefined) {
    return { exitCode: 2, stderr: "pass --name <s>\n" };
  }
  const body: { name: string } = { name: opts.name };
  await makeSdkClient(opts);
  try {
    const ws = unwrap(await patchApiWorkspacesById({ path: { id: workspaceId }, body }));
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── rm ────────────────────────────────────────────────────────────────
export interface WorkspaceRmOpts extends ConnectFlagOpts {
  readonly purge?: boolean;
}

export async function workspaceRm(
  workspaceId: string,
  opts: WorkspaceRmOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    // unwrap() even though the value is unused: preserves throw-on-non-2xx.
    unwrap(
      await deleteApiWorkspacesById({
        path: { id: workspaceId },
        ...(opts.purge ? { query: { purge: "1" } } : {}),
      }),
    );
    return {
      exitCode: 0,
      stdout: `workspace ${workspaceId} removed${opts.purge ? " (purged)" : ""}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// ─── reload ────────────────────────────────────────────────────────────
export type WorkspaceReloadOpts = ConnectFlagOpts;

export async function workspaceReload(
  workspaceId: string,
  opts: WorkspaceReloadOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    // unwrap() even though the value is unused: preserves throw-on-non-2xx.
    unwrap(await postApiWorkspacesByIdReload({ path: { id: workspaceId } }));
    return { exitCode: 0, stdout: `workspace ${workspaceId} reloaded\n` };
  } catch (err) {
    return formatError(err);
  }
}
