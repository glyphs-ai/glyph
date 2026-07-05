/**
 * `glyph catalog mcp ...` -- list / show / install / rm / sync-resolve /
 * sync over the workspace-scoped catalog MCPs HTTP surface.
 */

import {
  deleteApiWorkspacesByIdCatalogMcpsByScopeByName,
  getApiWorkspacesByIdCatalogMcps,
  getApiWorkspacesByIdCatalogMcpsByScopeByName,
  postApiWorkspacesByIdCatalogMcps,
  postApiWorkspacesByIdCatalogMcpsByScopeByNameSync,
  postApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResolve,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";
import { buildInstallOrigin, type InstallSourceFlags, splitCatalogFqn } from "./_helpers.js";

export type CatalogMcpListOpts = WorkspaceFlagOpts;

export async function catalogMcpList(opts: CatalogMcpListOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const list = unwrap(await getApiWorkspacesByIdCatalogMcps({ path: { id: workspaceId } }));
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["fqn", "origin", "installedAt"],
        list.map((m) => [m.fqn, m.origin, m.installedAt]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpShowOpts = WorkspaceFlagOpts;

export async function catalogMcpShow(
  fqn: string,
  opts: CatalogMcpShowOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(fqn);
    const mcp = unwrap(
      await getApiWorkspacesByIdCatalogMcpsByScopeByName({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: formatJson(mcp) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogMcpInstallOpts extends WorkspaceFlagOpts, InstallSourceFlags {}

export async function catalogMcpInstall(opts: CatalogMcpInstallOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  // Server contract is `{ origin }` only -- the fqn is derived from
  // the fetched JSON's `_meta.name` at install time, not from the
  // request body (see `validateMcpInstallInput`). The defense-in-depth
  // test in `cli/test/catalog-install-source.test.ts` pins this
  // contract; sending an extra `name` field would violate it.
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await postApiWorkspacesByIdCatalogMcps({
        path: { id: workspaceId },
        body: { origin: built.origin },
      }),
    );
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpRmOpts = WorkspaceFlagOpts;

export async function catalogMcpRm(
  fqn: string,
  opts: CatalogMcpRmOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(fqn);
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 404 must surface, not be swallowed).
    unwrap(
      await deleteApiWorkspacesByIdCatalogMcpsByScopeByName({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: `mcp ${fqn} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpSyncResolveOpts = WorkspaceFlagOpts;

/** Mirror of {@link catalogSkillSyncResolve} for MCPs. */
export async function catalogMcpSyncResolve(
  fqn: string,
  opts: CatalogMcpSyncResolveOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(fqn);
    const plan = unwrap(
      await postApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResolve({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpSyncOpts = WorkspaceFlagOpts;

/** Mirror of {@link catalogSkillSync} for MCPs. */
export async function catalogMcpSync(
  fqn: string,
  planToken: string,
  opts: CatalogMcpSyncOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  if (typeof planToken !== "string" || planToken.trim() === "") {
    return { exitCode: 2, stderr: "--plan-token is required (mint with `mcp sync-resolve`)\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(fqn);
    const result = unwrap(
      await postApiWorkspacesByIdCatalogMcpsByScopeByNameSync({
        path: { id: workspaceId, scope, name: shortName },
        body: { planToken },
      }),
    );
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}
