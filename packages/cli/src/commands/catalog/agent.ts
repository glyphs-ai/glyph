/**
 * `glyph catalog agent ...` -- list / resolve / show / install / rm /
 * sync-resolve / sync / ack-prereqs / enable / disable over the
 * workspace-scoped catalog agents HTTP surface.
 */

import { makeClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { buildInstallOrigin, type InstallSourceFlags } from "./_helpers.js";

export type CatalogAgentListOpts = WorkspaceFlagOpts;

export async function catalogAgentList(opts: CatalogAgentListOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const list = await client.call("catalog.agents.list", { params: { id: workspaceId } });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["fqn", "origin", "status"],
        list.map((entry) => [entry.agent.fqn, entry.agent.origin, entry.status]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogAgentResolveOpts extends WorkspaceFlagOpts, InstallSourceFlags {}

export async function catalogAgentResolve(opts: CatalogAgentResolveOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = await client.call("catalog.agents.resolve", {
      params: { id: workspaceId },
      body: { origin: built.origin },
    });
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogAgentShowOpts extends WorkspaceFlagOpts {
  /** When true, fetch the AGENTS.md anchor bytes via the dedicated endpoint instead of the entry. */
  readonly anchor?: boolean;
}

export async function catalogAgentShow(
  name: string,
  opts: CatalogAgentShowOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    if (opts.anchor === true) {
      // Dedicated anchor endpoint. Same rationale as
      // `catalogSkillShow` above.
      const res = await client.call("catalog.agents.anchor.get", {
        params: { id: workspaceId, name },
      });
      return { exitCode: 0, stdout: res.content };
    }
    const agent = await client.call("catalog.agents.get", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(agent) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogAgentInstallOpts extends WorkspaceFlagOpts, InstallSourceFlags {}

export async function catalogAgentInstall(opts: CatalogAgentInstallOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.agents.install", {
      params: { id: workspaceId },
      body: { origin: built.origin },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentRmOpts = WorkspaceFlagOpts;

export async function catalogAgentRm(
  name: string,
  opts: CatalogAgentRmOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    await client.call("catalog.agents.delete", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: `agent ${name} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentSyncResolveOpts = WorkspaceFlagOpts;

/** Mirror of {@link catalogSkillSyncResolve} for agents. */
export async function catalogAgentSyncResolve(
  name: string,
  opts: CatalogAgentSyncResolveOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = await client.call("catalog.agents.sync.resolve", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentSyncOpts = WorkspaceFlagOpts;

/** Mirror of {@link catalogSkillSync} for agents. */
export async function catalogAgentSync(
  name: string,
  planToken: string,
  opts: CatalogAgentSyncOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  if (typeof planToken !== "string" || planToken.trim() === "") {
    return { exitCode: 2, stderr: "--plan-token is required (mint with `agent sync-resolve`)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.agents.sync", {
      params: { id: workspaceId, name },
      body: { planToken },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentAckPrereqsOpts = WorkspaceFlagOpts;

/** Mirror of {@link catalogSkillAckPrereqs} for agents. */
export async function catalogAgentAckPrereqs(
  name: string,
  opts: CatalogAgentAckPrereqsOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const agent = await client.call("catalog.agents.prereqs.acknowledge", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(agent) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentEnableOpts = WorkspaceFlagOpts;

/**
 * Re-enable a disabled agent. Unlike skills/MCPs, agents
 * are user-toggleable; this lifts the `disabledByUser` block and lets
 * tasks dispatch against the agent again.
 */
export async function catalogAgentEnable(
  name: string,
  opts: CatalogAgentEnableOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const agent = await client.call("catalog.agents.enable", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(agent) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogAgentDisableOpts = WorkspaceFlagOpts;

/**
 * Disable an agent. Pending tasks still drain; new dispatches fail
 * with `EntryNotReadyError` (`disabledByUser`). Re-enable via
 * {@link catalogAgentEnable}.
 */
export async function catalogAgentDisable(
  name: string,
  opts: CatalogAgentDisableOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "agent name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const agent = await client.call("catalog.agents.disable", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(agent) };
  } catch (err) {
    return formatError(err);
  }
}
