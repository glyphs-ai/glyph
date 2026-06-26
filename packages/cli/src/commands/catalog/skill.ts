/**
 * `glyph catalog skill ...` -- list / resolve / show / install / rm /
 * sync-resolve / sync / ack-prereqs over the workspace-scoped catalog
 * skills HTTP surface.
 */

import type {
  PostApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResponses,
  PostApiWorkspacesByIdCatalogSkillsResolveResponses,
  PostApiWorkspacesByIdCatalogSkillsResponses,
} from "@glyphs-ai/sdk";
import {
  deleteApiWorkspacesByIdCatalogSkillsByScopeByName,
  getApiWorkspacesByIdCatalogSkills,
  getApiWorkspacesByIdCatalogSkillsByScopeByName,
  getApiWorkspacesByIdCatalogSkillsByScopeByNameAnchor,
  postApiWorkspacesByIdCatalogSkillsByScopeByNameAcknowledgePrereqs,
  postApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResolve,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";
import { buildInstallOrigin, type InstallSourceFlags, splitCatalogFqn } from "./_helpers.js";

export type CatalogSkillListOpts = WorkspaceFlagOpts;

export async function catalogSkillList(opts: CatalogSkillListOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const list = unwrap(await getApiWorkspacesByIdCatalogSkills({ path: { id: workspaceId } }));
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

export interface CatalogSkillResolveOpts extends WorkspaceFlagOpts, InstallSourceFlags {}

export async function catalogSkillResolve(opts: CatalogSkillResolveOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const plan = unwrap(
      await client.post<PostApiWorkspacesByIdCatalogSkillsResolveResponses>({
        url: "/api/workspaces/{id}/catalog/skills/resolve",
        path: { id: workspaceId },
        body: { origin: built.origin },
      }),
    );
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogSkillShowOpts extends WorkspaceFlagOpts {
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(name);
    if (opts.anchor === true) {
      // Dedicated anchor endpoint -- returns just the
      // SKILL.md bytes without the surrounding entry metadata. Use the
      // raw bytes as stdout so callers can `>` pipe them straight to a
      // file.
      const res = unwrap(
        await getApiWorkspacesByIdCatalogSkillsByScopeByNameAnchor({
          path: { id: workspaceId, scope, name: shortName },
        }),
      );
      return { exitCode: 0, stdout: res.content };
    }
    const skill = unwrap(
      await getApiWorkspacesByIdCatalogSkillsByScopeByName({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: formatJson(skill) };
  } catch (err) {
    return formatError(err);
  }
}

export interface CatalogSkillInstallOpts extends WorkspaceFlagOpts, InstallSourceFlags {}

export async function catalogSkillInstall(opts: CatalogSkillInstallOpts): Promise<CommandResult> {
  const built = buildInstallOrigin(opts);
  if ("error" in built) {
    return { exitCode: 2, stderr: `${built.error}\n` };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdCatalogSkillsResponses>({
        url: "/api/workspaces/{id}/catalog/skills",
        path: { id: workspaceId },
        body: { origin: built.origin },
      }),
    );
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillRmOpts = WorkspaceFlagOpts;

export async function catalogSkillRm(
  name: string,
  opts: CatalogSkillRmOpts = {},
): Promise<CommandResult> {
  if (typeof name !== "string" || name.trim() === "") {
    return { exitCode: 2, stderr: "skill name is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(name);
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 404 must surface, not be swallowed).
    unwrap(
      await deleteApiWorkspacesByIdCatalogSkillsByScopeByName({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: `skill ${name} removed\n` };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillSyncResolveOpts = WorkspaceFlagOpts;

/**
 * Re-resolve an installed skill against its upstream origin and return
 * a fresh install plan (without applying it). The plan is one-shot --
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(name);
    const plan = unwrap(
      await postApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResolve({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: formatJson(plan) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillSyncOpts = WorkspaceFlagOpts;

/**
 * Apply a previewed sync plan. `planToken` MUST come from a
 * recent `catalog.skills.syncResolve` response -- the server enforces a
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
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(name);
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResponses>({
        url: "/api/workspaces/{id}/catalog/skills/{scope}/{name}/sync",
        path: { id: workspaceId, scope, name: shortName },
        body: { planToken },
      }),
    );
    return { exitCode: 0, stdout: formatJson(result) };
  } catch (err) {
    return formatError(err);
  }
}

export type CatalogSkillAckPrereqsOpts = WorkspaceFlagOpts;

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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const { scope, name: shortName } = splitCatalogFqn(name);
    const skill = unwrap(
      await postApiWorkspacesByIdCatalogSkillsByScopeByNameAcknowledgePrereqs({
        path: { id: workspaceId, scope, name: shortName },
      }),
    );
    return { exitCode: 0, stdout: formatJson(skill) };
  } catch (err) {
    return formatError(err);
  }
}
