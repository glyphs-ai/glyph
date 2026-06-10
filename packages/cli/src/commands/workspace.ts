/**
 * `glyph workspace …` — subcommands wrapping the workspace HTTP
 * surface (list / add / current / show / update / rm / reload).
 *
 * Every command takes `--server` / `--output` (some also `--json`
 * shorthand). Workspace-scoped flags (`--workspace`) live in the family
 * commands (`session`, `schedule`, `task`, `workflow`, `catalog`).
 */

import { makeClient } from "../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../output.js";
import type { CommandResult } from "../result.js";

interface CommonFlags {
  readonly server?: string;
  readonly home?: string;
  readonly output?: string;
  readonly json?: boolean;
}

// ─── list ──────────────────────────────────────────────────────────────
export type WorkspaceListOpts = CommonFlags;

export async function workspaceList(opts: WorkspaceListOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const list = await client.call("workspaces.list");
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
export interface WorkspaceAddOpts extends CommonFlags {
  readonly name: string;
  /** Absolute path; server mints `<GLYPH_HOME>/workspaces/<uuid>` when omitted. */
  readonly workspaceDir?: string;
}

export async function workspaceAdd(opts: WorkspaceAddOpts): Promise<CommandResult> {
  if (typeof opts.name !== "string" || opts.name.trim() === "") {
    return { exitCode: 2, stderr: "missing required --name <name>\n" };
  }
  const client = await makeClient(opts);
  try {
    const body = {
      name: opts.name,
      ...(opts.workspaceDir !== undefined ? { workspaceDir: opts.workspaceDir } : {}),
    };
    const ws = await client.call("workspaces.create", { body });
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── current ───────────────────────────────────────────────────────────
export type WorkspaceCurrentOpts = CommonFlags;

export async function workspaceCurrent(opts: WorkspaceCurrentOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const cur = await client.call("workspaces.current.get");
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(cur) };
    return { exitCode: 0, stdout: `${cur.id ?? "(none)"}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── show ──────────────────────────────────────────────────────────────
export type WorkspaceShowOpts = CommonFlags;

export async function workspaceShow(
  workspaceId: string,
  opts: WorkspaceShowOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const ws = await client.call("workspaces.get", { params: { id: workspaceId } });
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── update ────────────────────────────────────────────────────────────
export interface WorkspaceUpdateOpts extends CommonFlags {
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
  const body: { name?: string } = { name: opts.name };
  const client = await makeClient(opts);
  try {
    const ws = await client.call("workspaces.update", { params: { id: workspaceId }, body });
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ws) : formatRecord({ ...ws });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── rm ────────────────────────────────────────────────────────────────
export interface WorkspaceRmOpts extends CommonFlags {
  readonly purge?: boolean;
}

export async function workspaceRm(
  workspaceId: string,
  opts: WorkspaceRmOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  const client = await makeClient(opts);
  try {
    await client.call("workspaces.delete", {
      params: { id: workspaceId },
      ...(opts.purge ? { query: { purge: "1" } } : {}),
    });
    return {
      exitCode: 0,
      stdout: `workspace ${workspaceId} removed${opts.purge ? " (purged)" : ""}\n`,
    };
  } catch (err) {
    return formatError(err);
  }
}

// ─── reload ────────────────────────────────────────────────────────────
export type WorkspaceReloadOpts = CommonFlags;

export async function workspaceReload(
  workspaceId: string,
  opts: WorkspaceReloadOpts = {},
): Promise<CommandResult> {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return { exitCode: 2, stderr: "workspace id is required\n" };
  }
  const client = await makeClient(opts);
  try {
    await client.call("workspaces.reload", { params: { id: workspaceId } });
    return { exitCode: 0, stdout: `workspace ${workspaceId} reloaded\n` };
  } catch (err) {
    return formatError(err);
  }
}
