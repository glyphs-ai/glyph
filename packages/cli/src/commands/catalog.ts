/**
 * `glyph catalog …` — wraps the workspace-scoped catalog HTTP surface.
 *
 * Three resource families behind one parent command:
 *  - `skill {list, resolve, show, install, rm, sync-resolve, sync, ack-prereqs}`
 *  - `agent {list, resolve, show, install, rm, sync-resolve, sync, ack-prereqs, enable, disable}`
 *  - `mcp   {list, show, install, rm, sync-resolve, sync}`
 *
 * Plus `catalog overview` for the per-workspace counts. Each exported
 * function maps 1:1 to a `ROUTES` manifest entry; counts are
 * intentionally not stated here because the per-family verb sets
 * evolve and the precise count is recoverable from this file.
 */

import { makeClient, resolveWorkspace } from "../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../output.js";
import type { CommandResult } from "../result.js";

interface CommonFlags {
  readonly server?: string;
  readonly home?: string;
  readonly workspaceId?: string;
  readonly output?: string;
  readonly json?: boolean;
}

/**
 * Mutually-exclusive `--url <value>` / `--file <path>` flag pair shared
 * by every catalog install / resolve command. The user picks ONE; the
 * CLI assembles the canonical wire origin via {@link buildInstallOrigin}.
 */
interface InstallSourceFlags {
  readonly url?: string;
  readonly file?: string;
}

/**
 * Build the canonical wire origin from the CLI's `--url` / `--file` flags.
 *
 * Exactly one flag must be set. Returns either:
 *  - `{ origin }` — ready for the wire payload, OR
 *  - `{ error }`  — a human-readable message for stderr (exit code 2).
 *
 * Rules:
 *  - `--url <value>` is pass-through (the server's `parseOrigin` picks the
 *    fetcher from the URL grammar; today only `https://github.com/...` is
 *    accepted, with `parseOrigin` returning a clear "unsupported scheme"
 *    error otherwise).
 *  - `--file <path>` prepends `file:` if not already prefixed (tolerates
 *    paste of `file:/abs/x`).
 *  - `--url file:...` is rejected — picking URL with a `file:` URI is a
 *    misuse. Suggest `--file` instead.
 *  - Neither flag, both flags → usage error listing both.
 *  - Whitespace-only flag values are treated as missing.
 *
 * Mirror lives in `packages/dashboard/src/api/catalog.ts`
 * (`buildOriginFromSource`) so the same shape is rejected at both
 * client-input boundaries.
 */
function buildInstallOrigin(opts: InstallSourceFlags): { origin: string } | { error: string } {
  const url = typeof opts.url === "string" ? opts.url.trim() : "";
  const file = typeof opts.file === "string" ? opts.file.trim() : "";
  if (url === "" && file === "") {
    return { error: "must provide --url <value> or --file <path>" };
  }
  if (url !== "" && file !== "") {
    return { error: "cannot provide both --url and --file; pick one" };
  }
  if (url !== "") {
    if (url.startsWith("file:")) {
      return { error: 'URL source cannot be a "file:" URI; use --file <path> instead' };
    }
    return { origin: url };
  }
  return { origin: file.startsWith("file:") ? file : `file:${file}` };
}

// ─── overview ──────────────────────────────────────────────────────────
export type CatalogOverviewOpts = CommonFlags;

export async function catalogOverview(opts: CatalogOverviewOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const ov = await client.call("catalog.overview.get", { params: { id: workspaceId } });
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ov) : formatRecord({ ...ov.counts });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── skills ────────────────────────────────────────────────────────────

export type CatalogSkillListOpts = CommonFlags;

export async function catalogSkillList(opts: CatalogSkillListOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const list = await client.call("catalog.skills.list", { params: { id: workspaceId } });
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["fqn", "origin", "status"],
        list.map((entry) => [entry.skill.fqn, entry.skill.origin, entry.status]),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogSkillResolveOpts extends CommonFlags, InstallSourceFlags {}

export async function catalogSkillResolve(opts: CatalogSkillResolveOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = await client.call("catalog.skills.resolve", {
      params: { id: workspaceId },
      body: { origin: built.origin },
    });
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogSkillShowOpts extends CommonFlags {
  /** When true, fetch the SKILL.md anchor bytes via the dedicated endpoint instead of the entry. */
  readonly anchor?: boolean;
}

export async function catalogSkillShow(
  name: string,
  opts: CatalogSkillShowOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    if (opts.anchor === true) {
      // Dedicated anchor endpoint — returns just the
      // SKILL.md bytes without the surrounding entry metadata. Use the
      // raw bytes as stdout so callers can `>` pipe them straight to a
      // file.
      const res = await client.call("catalog.skills.anchor.get", {
        params: { id: workspaceId, name },
      });
      return { exitCode: 0, stdout: res.content };
    }
    const skill = await client.call("catalog.skills.get", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(skill) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogSkillInstallOpts extends CommonFlags, InstallSourceFlags {}

export async function catalogSkillInstall(opts: CatalogSkillInstallOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.skills.install", {
      params: { id: workspaceId },
      body: { origin: built.origin },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillRmOpts = CommonFlags;

export async function catalogSkillRm(
  name: string,
  opts: CatalogSkillRmOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    await client.call("catalog.skills.delete", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: `skill ${name} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillSyncResolveOpts = CommonFlags;

/**
 * Re-resolve an installed skill against its upstream origin and return
 * a fresh install plan (without applying it). The plan is one-shot —
 * pass `result.planToken` to {@link catalogSkillSync} within 5 minutes
 * to apply.
 */
export async function catalogSkillSyncResolve(
  name: string,
  opts: CatalogSkillSyncResolveOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = await client.call("catalog.skills.sync.resolve", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillSyncOpts = CommonFlags;

/**
 * Apply a previewed sync plan. `planToken` MUST come from a
 * recent `catalog.skills.syncResolve` response — the server enforces a
 * single-use, 5-minute TTL on tokens to keep the apply step replaying
 * the exact preview-time plan.
 */
export async function catalogSkillSync(
  name: string,
  planToken: string,
  opts: CatalogSkillSyncOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  if (typeof planToken !== "string" || planToken.trim() === "") {
    return { exitCode: 2, stderr: "--plan-token is required (mint with `skill sync-resolve`)\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.skills.sync", {
      params: { id: workspaceId, name },
      body: { planToken },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillAckPrereqsOpts = CommonFlags;

/**
 * Mark a skill's `prereqs` as acknowledged for this installation. The
 * status flips out of `blocked` (when `needsPrereqsAck` was the only
 * cause) and tasks that depend on it can be dispatched.
 */
export async function catalogSkillAckPrereqs(
  name: string,
  opts: CatalogSkillAckPrereqsOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const skill = await client.call("catalog.skills.prereqs.acknowledge", {
      params: { id: workspaceId, name },
    });
    return { exitCode: 0, stdout: formatJson(skill) };
  } catch (err) {
    return formatError(err);
  }
}

// ─── agents ────────────────────────────────────────────────────────────

export type CatalogAgentListOpts = CommonFlags;

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

export interface CatalogAgentResolveOpts extends CommonFlags, InstallSourceFlags {}

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

export interface CatalogAgentShowOpts extends CommonFlags {
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

export interface CatalogAgentInstallOpts extends CommonFlags, InstallSourceFlags {}

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

export type CatalogAgentRmOpts = CommonFlags;

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

export type CatalogAgentSyncResolveOpts = CommonFlags;

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

export type CatalogAgentSyncOpts = CommonFlags;

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

export type CatalogAgentAckPrereqsOpts = CommonFlags;

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

export type CatalogAgentEnableOpts = CommonFlags;

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

export type CatalogAgentDisableOpts = CommonFlags;

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

// ─── mcps ──────────────────────────────────────────────────────────────

export type CatalogMcpListOpts = CommonFlags;

export async function catalogMcpList(opts: CatalogMcpListOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const list = await client.call("catalog.mcps.list", { params: { id: workspaceId } });
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

export type CatalogMcpShowOpts = CommonFlags;

export async function catalogMcpShow(
  fqn: string,
  opts: CatalogMcpShowOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const mcp = await client.call("catalog.mcps.get", {
      params: { id: workspaceId, name: fqn },
    });
    return { exitCode: 0, stdout: formatJson(mcp) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogMcpInstallOpts extends CommonFlags, InstallSourceFlags {}

export async function catalogMcpInstall(opts: CatalogMcpInstallOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  // Server contract is `{ origin }` only — the fqn is derived from
  // the fetched JSON's `_meta.name` at install time, not from the
  // request body (see `validateMcpInstallInput`). The defense-in-depth
  // test at `cli/test/api-client.test.ts:249` pins this contract;
  // sending an extra `name` field would violate it.
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.mcps.install", {
      params: { id: workspaceId },
      body: { origin: built.origin },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpRmOpts = CommonFlags;

export async function catalogMcpRm(
  fqn: string,
  opts: CatalogMcpRmOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    await client.call("catalog.mcps.delete", {
      params: { id: workspaceId, name: fqn },
    });
    return { exitCode: 0, stdout: `mcp ${fqn} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpSyncResolveOpts = CommonFlags;

/** Mirror of {@link catalogSkillSyncResolve} for MCPs. */
export async function catalogMcpSyncResolve(
  fqn: string,
  opts: CatalogMcpSyncResolveOpts = {},
): Promise<CommandResult> {
  if (typeof fqn !== "string" || fqn.trim() === "") {
    return { exitCode: 2, stderr: "mcp fqn is required\n" };
  }
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = await client.call("catalog.mcps.sync.resolve", {
      params: { id: workspaceId, name: fqn },
    });
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogMcpSyncOpts = CommonFlags;

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
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = await client.call("catalog.mcps.sync", {
      params: { id: workspaceId, name: fqn },
      body: { planToken },
    });
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}
