import type {
  GetApiWorkspacesByIdCatalogAgentsResponse,
  GetApiWorkspacesByIdCatalogMcpsByScopeByNameResponse,
  GetApiWorkspacesByIdCatalogMcpsResponse,
  GetApiWorkspacesByIdCatalogSkillsResponse,
  PostApiWorkspacesByIdCatalogAgentsByScopeByNameSyncResponses,
  PostApiWorkspacesByIdCatalogAgentsData,
  PostApiWorkspacesByIdCatalogAgentsResolveResponse,
  PostApiWorkspacesByIdCatalogAgentsResponse,
  PostApiWorkspacesByIdCatalogAgentsResponses,
  PostApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResponses,
  PostApiWorkspacesByIdCatalogMcpsResponses,
  PostApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResponses,
  PostApiWorkspacesByIdCatalogSkillsData,
  PostApiWorkspacesByIdCatalogSkillsResponses,
} from "@glyphs-ai/sdk";
import {
  client,
  deleteApiWorkspacesByIdCatalogAgentsByScopeByName,
  deleteApiWorkspacesByIdCatalogMcpsByScopeByName,
  deleteApiWorkspacesByIdCatalogSkillsByScopeByName,
  getApiWorkspacesByIdCatalogAgents,
  getApiWorkspacesByIdCatalogAgentsByScopeByName,
  getApiWorkspacesByIdCatalogAgentsByScopeByNameFiles,
  getApiWorkspacesByIdCatalogMcps,
  getApiWorkspacesByIdCatalogMcpsByScopeByName,
  getApiWorkspacesByIdCatalogOverview,
  getApiWorkspacesByIdCatalogSkills,
  getApiWorkspacesByIdCatalogSkillsByScopeByName,
  getApiWorkspacesByIdCatalogSkillsByScopeByNameFiles,
  postApiWorkspacesByIdCatalogAgentsByScopeByNameAcknowledgePrereqs,
  postApiWorkspacesByIdCatalogAgentsByScopeByNameDisable,
  postApiWorkspacesByIdCatalogAgentsByScopeByNameEnable,
  postApiWorkspacesByIdCatalogAgentsByScopeByNameSyncResolve,
  postApiWorkspacesByIdCatalogAgentsResolve,
  postApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResolve,
  postApiWorkspacesByIdCatalogSkillsByScopeByNameAcknowledgePrereqs,
  postApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResolve,
  postApiWorkspacesByIdCatalogSkillsResolve,
} from "@glyphs-ai/sdk";
import { workspacePrefix } from "./http.js";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";

// Local type aliases for catalog shapes (previously exported from sdk/wire.ts).
export type AgentEntry = GetApiWorkspacesByIdCatalogAgentsResponse[number];
export type Agent = AgentEntry["agent"];
export type SkillEntry = GetApiWorkspacesByIdCatalogSkillsResponse[number];
export type Skill = SkillEntry["skill"];
export type Mcp = GetApiWorkspacesByIdCatalogMcpsResponse[number];
export type CatalogKind = PostApiWorkspacesByIdCatalogAgentsResponse["installed"][number]["kind"];
export type BlockedReason = NonNullable<AgentEntry["blockedReason"]>;
export type MissingDep = NonNullable<SkillEntry["missingDeps"]>[number];
export type InstallAgentRequest = PostApiWorkspacesByIdCatalogAgentsData["body"];
export type InstallSkillRequest = PostApiWorkspacesByIdCatalogSkillsData["body"];

export interface OverviewData {
  counts: {
    skills: number;
    agents: number;
    mcps: number;
    blocked: number;
    orphaned: number;
  };
}

/**
 * Wire shape for an installed MCP — mirrors @glyphs-ai/catalog `Mcp`.
 */
export type McpItem = Mcp;

export interface CatalogData {
  overview: OverviewData | null;
  skills: SkillEntry[];
  agents: AgentEntry[];
  mcps: McpItem[];
}

/** URL prefix for the active workspace's catalog endpoints. */
function catalogPrefix(): string {
  return `${workspacePrefix()}/catalog`;
}

/**
 * Split a catalog resource FQN into its `{scope}/{name}` path segments.
 *
 * Catalog resources are addressed by a two-segment `{scope}/{name}` route
 * (e.g. `official/git-pr`). The FQN carries exactly one slash separating
 * the scope from the short name; split on that first slash so each half can
 * ride as a discrete typed `path` param (the generated SDK ops percent-encode
 * each segment individually). Mirrors the CLI's `splitCatalogFqn`.
 */
function splitFqn(fqn: string): { scope: string; name: string } {
  const slash = fqn.indexOf("/");
  if (slash === -1) {
    return { scope: fqn, name: "" };
  }
  return { scope: fqn.slice(0, slash), name: fqn.slice(slash + 1) };
}

export async function fetchAll(): Promise<CatalogData> {
  const path = { id: requireWorkspaceId() };
  const [overview, skills, agents, mcps] = await Promise.all([
    getApiWorkspacesByIdCatalogOverview({ path }),
    getApiWorkspacesByIdCatalogSkills({ path }),
    getApiWorkspacesByIdCatalogAgents({ path }),
    getApiWorkspacesByIdCatalogMcps({ path }),
  ]);
  return {
    overview: unwrap(overview),
    skills: unwrap(skills),
    agents: unwrap(agents),
    mcps: unwrap(mcps),
  };
}

/**
 * User-facing install source. `"url"` covers every fetcher whose origin is
 * a URL — the catalog's `parseOrigin`
 * sniffs the URL grammar to pick the right fetcher. `"file"` always means
 * the local file fetcher (server-side `file:` scheme).
 *
 * The dashboard never asks the user "what kind of URL"; that's the
 * server's job. Picking the wrong fetcher would surface as a clear
 * "unsupported scheme" error from `parseOrigin`.
 */
export type InstallProvider = "url" | "file";

export interface InstallSource {
  /** Pick the source kind whose grammar matches your input. */
  provider: InstallProvider;
  /**
   * What the user typed:
   *  - `url`:  full URL (e.g. `https://github.com/owner/repo/tree/ref/path`).
   *            Pass-through to the wire — the server's `parseOrigin` picks the
   *            fetcher from the URL grammar.
   *  - `file`: absolute path on the **server's** filesystem (the dashboard
   *            and CLI both target the server, not the local machine).
   *            The client adds the `file:` prefix transparently.
   * Whitespace is trimmed.
   */
  location: string;
}

/**
 * Assemble a canonical origin URI from the dashboard's UI form.
 *
 *   - `url`  + `https://github.com/owner/repo/tree/ref/path` →
 *     pass-through (the server's `parseOrigin` picks the fetcher
 *     from the URL grammar)
 *   - `file` + `/abs/path`            → `file:/abs/path`
 *   - `file` + `file:/abs/path`       → `file:/abs/path` (tolerate
 *     paste with prefix; trim and re-emit)
 *
 * Smuggling guard: `url` + a `file:` URI is rejected — the user
 * almost certainly meant to pick `file`. The mirror lives in the
 * CLI's `buildInstallOrigin` so both layers reject the same shape.
 *
 * Mirrors the CLI's origin assembly for the `--url` / `--file`
 * install paths. Tests in `dashboard/test/buildOriginFromSource.test.ts`
 * pin the contract.
 */
export function buildOriginFromSource(src: InstallSource): string {
  const trimmed = src.location.trim();
  switch (src.provider) {
    case "url":
      // Smuggling guard: if the user picked URL but typed a `file:` URI,
      // they almost certainly meant to pick File. Reject with a clear
      // error so we don't silently route a "file" install through a
      // mis-labelled provider. The mirror exists in CLI's flag validator.
      if (trimmed.startsWith("file:")) {
        throw new Error(
          'URL source cannot be a "file:" URI. Pick "File" and enter the path instead.',
        );
      }
      return trimmed;
    case "file":
      return trimmed.startsWith("file:") ? trimmed : `file:${trimmed}`;
  }
}

/**
 * Wire mirror of `@glyphs-ai/catalog` ``CatalogInstalledEntry``. Each
 * row in `installed[]` carries enough info for the dashboard to
 * prompt the user about pending prereqs without a follow-up GET.
 */
interface InstalledEntry {
  kind: "skill" | "agent" | "mcp";
  fqn: string;
  /** Frontmatter prereqs text. Absent for mcps and for entries with no prereqs. */
  prereqs?: string;
  /** Per-installation ack flag. Absent for mcps. False iff prereqs is set and pending ack. */
  prereqsAck?: boolean;
}

/** Wire mirror of `@glyphs-ai/catalog` ``CatalogInstallResult``. */
export interface InstallResult {
  installed: InstalledEntry[];
  skipped: { kind: "skill" | "agent" | "mcp"; fqn: string; reason: string }[];
  failed: {
    kind: "skill" | "agent" | "mcp";
    fqn: string;
    error: { name: string; message: string };
  }[];
}

/** Wire mirror of `@glyphs-ai/catalog` ``CatalogSyncResult``. */
interface SyncResult extends InstallResult {
  orphansFlagged: { kind: "skill" | "mcp"; fqn: string; origin: string }[];
}

/**
 * Install an agent (and its transitively-required deps) from a user-
 * supplied source. The dashboard's `provider + location` form is
 * assembled into a canonical `origin` URI client-side via
 * {@link buildOriginFromSource}; the wire body is just `{ origin }`,
 * identical to what the CLI sends.
 *
 * On partial failure the server returns 207 with a populated
 * `failed[]` (and possibly `installed[]`) — both are surfaced to the
 * caller through {@link InstallResult}.
 *
 * Scope is determined entirely by each entry's frontmatter (or the
 * default `public`). There is intentionally no per-install
 * `scopeHints` field: forking into a different scope means editing
 * the upstream's frontmatter, not flipping a UI toggle.
 *
 * The install / resolve routes are hand-validated (the generated op
 * types their body as `never`), so they go through the low-level
 * `client.post` with the operation's response type; the `satisfies`
 * pins the body to its named request DTO. MCP carries no re-exported
 * request type, so its installer uses an inline `{ origin }` literal.
 */
export const installAgent = async (src: InstallSource): Promise<InstallResult> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdCatalogAgentsResponses>({
      url: "/api/workspaces/{id}/catalog/agents",
      path: { id: requireWorkspaceId() },
      body: { origin: buildOriginFromSource(src) } satisfies InstallAgentRequest,
    }),
  );

/** See {@link installAgent}. */
export const installSkill = async (src: InstallSource): Promise<InstallResult> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdCatalogSkillsResponses>({
      url: "/api/workspaces/{id}/catalog/skills",
      path: { id: requireWorkspaceId() },
      body: { origin: buildOriginFromSource(src) } satisfies InstallSkillRequest,
    }),
  );

/**
 * Install an MCP. The MCP's spec FQN is recovered from the fetched
 * JSON's `_meta.name` at install time, so callers don't need to
 * supply a name.
 */
export const installMcp = async (src: InstallSource): Promise<InstallResult> =>
  unwrap(
    await client.post<PostApiWorkspacesByIdCatalogMcpsResponses>({
      url: "/api/workspaces/{id}/catalog/mcps",
      path: { id: requireWorkspaceId() },
      body: { origin: buildOriginFromSource(src) } satisfies { readonly origin: string },
    }),
  );

/**
 * Resolve manifest returned by `POST /catalog/{kind}/resolve` (install) and
 * `POST /catalog/{kind}/{scope}/{name}/sync/resolve` (sync). All six resolve
 * endpoints return the same shape; we derive the type from the agent install
 * resolve response which is representative.
 */
export type ResolveManifest = NonNullable<PostApiWorkspacesByIdCatalogAgentsResolveResponse>;
export type ResolveNode = ResolveManifest["nodes"][number];
export type OrphanManifestEntry = ResolveManifest["orphans"][number];

/**
 * Resolve an install (`POST /catalog/{kind}/resolve`) — returns the
 * read-only `ResolveManifest` so the user can preview the tree before
 * committing.
 */
export const resolveSkillInstall = async (src: InstallSource): Promise<ResolveManifest> =>
  unwrap(
    await postApiWorkspacesByIdCatalogSkillsResolve({
      path: { id: requireWorkspaceId() },
      body: { origin: buildOriginFromSource(src) },
    }),
  );

export const resolveAgentInstall = async (src: InstallSource): Promise<ResolveManifest> =>
  unwrap(
    await postApiWorkspacesByIdCatalogAgentsResolve({
      path: { id: requireWorkspaceId() },
      body: { origin: buildOriginFromSource(src) },
    }),
  );

/**
 * Resolve a sync from upstream for an already-installed entry. Returns a
 * richer manifest than install resolve: `upToDate` short-circuits the apply
 * button, `identityChange` warns when upstream renamed under the same URL,
 * `orphans` lists deps the new closure dropped.
 */
export const resolveSkillSync = async (fqn: string): Promise<ResolveManifest> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await postApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResolve({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const resolveAgentSync = async (fqn: string): Promise<ResolveManifest> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await postApiWorkspacesByIdCatalogAgentsByScopeByNameSyncResolve({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const resolveMcpSync = async (name: string): Promise<ResolveManifest> => {
  const { scope, name: shortName } = splitFqn(name);
  return unwrap(
    await postApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResolve({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

/**
 * Apply a previously-previewed sync. The `planToken` MUST come from
 * the matching `resolve*Sync` response — the server replays that
 * exact plan instead of re-resolving (otherwise upstream drift
 * between preview and apply would silently change what gets
 * installed). Token is single-use; a 410 means it expired (default
 * 5 min) or was already consumed, and the dashboard should
 * re-preview.
 *
 * Hand-validated `{ planToken }` body, so it goes through the
 * low-level `client.post` with the operation's response type.
 */
export const applySkillSync = async (fqn: string, planToken: string): Promise<SyncResult> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await client.post<PostApiWorkspacesByIdCatalogSkillsByScopeByNameSyncResponses>({
      url: "/api/workspaces/{id}/catalog/skills/{scope}/{name}/sync",
      path: { id: requireWorkspaceId(), scope, name },
      body: { planToken },
    }),
  );
};

export const applyAgentSync = async (fqn: string, planToken: string): Promise<SyncResult> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await client.post<PostApiWorkspacesByIdCatalogAgentsByScopeByNameSyncResponses>({
      url: "/api/workspaces/{id}/catalog/agents/{scope}/{name}/sync",
      path: { id: requireWorkspaceId(), scope, name },
      body: { planToken },
    }),
  );
};

export const applyMcpSync = async (name: string, planToken: string): Promise<SyncResult> => {
  const { scope, name: shortName } = splitFqn(name);
  return unwrap(
    await client.post<PostApiWorkspacesByIdCatalogMcpsByScopeByNameSyncResponses>({
      url: "/api/workspaces/{id}/catalog/mcps/{scope}/{name}/sync",
      path: { id: requireWorkspaceId(), scope, name: shortName },
      body: { planToken },
    }),
  );
};

/** Acknowledge prereqs: flips `prereqsAck=true` so the entry can run again. */
export const acknowledgeSkillPrereqs = async (fqn: string): Promise<void> => {
  const { scope, name } = splitFqn(fqn);
  unwrap(
    await postApiWorkspacesByIdCatalogSkillsByScopeByNameAcknowledgePrereqs({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const acknowledgeAgentPrereqs = async (fqn: string): Promise<void> => {
  const { scope, name } = splitFqn(fqn);
  unwrap(
    await postApiWorkspacesByIdCatalogAgentsByScopeByNameAcknowledgePrereqs({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

/** Disable / enable an agent (user-controlled toggle; agents only). */
export const disableAgent = async (fqn: string): Promise<void> => {
  const { scope, name } = splitFqn(fqn);
  unwrap(
    await postApiWorkspacesByIdCatalogAgentsByScopeByNameDisable({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const enableAgent = async (fqn: string): Promise<void> => {
  const { scope, name } = splitFqn(fqn);
  unwrap(
    await postApiWorkspacesByIdCatalogAgentsByScopeByNameEnable({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const deleteAgent = async (name: string): Promise<void> => {
  const { scope, name: shortName } = splitFqn(name);
  unwrap(
    await deleteApiWorkspacesByIdCatalogAgentsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

export const deleteSkill = async (name: string): Promise<void> => {
  const { scope, name: shortName } = splitFqn(name);
  unwrap(
    await deleteApiWorkspacesByIdCatalogSkillsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

export const deleteMcp = async (name: string): Promise<void> => {
  const { scope, name: shortName } = splitFqn(name);
  unwrap(
    await deleteApiWorkspacesByIdCatalogMcpsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

/** Wire shape for an installed MCP detail (fqn, origin, orphaned, content). */
export type McpDetail = GetApiWorkspacesByIdCatalogMcpsByScopeByNameResponse;

export const getMcp = async (name: string): Promise<McpDetail> => {
  const { scope, name: shortName } = splitFqn(name);
  return unwrap(
    await getApiWorkspacesByIdCatalogMcpsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

export interface SkillDetail {
  skill: Skill;
  status: "ready" | "blocked";
  blockedReason?: BlockedReason;
  missingDeps?: MissingDep[];
  content: string;
}

export const getSkill = async (name: string): Promise<SkillDetail> => {
  const { scope, name: shortName } = splitFqn(name);
  return unwrap(
    await getApiWorkspacesByIdCatalogSkillsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

export interface AgentDetail {
  agent: Agent;
  status: "ready" | "blocked";
  blockedReason?: BlockedReason;
  missingDeps?: MissingDep[];
  content: string;
}

export const getAgent = async (name: string): Promise<AgentDetail> => {
  const { scope, name: shortName } = splitFqn(name);
  return unwrap(
    await getApiWorkspacesByIdCatalogAgentsByScopeByName({
      path: { id: requireWorkspaceId(), scope, name: shortName },
    }),
  );
};

// ── File browser API ────────────────────────────────────────────────

/** Wire shape for a single file in the catalog file listing. */
export interface CatalogFileEntry {
  relPath: string;
  size: number;
}

export const listSkillFiles = async (fqn: string): Promise<CatalogFileEntry[]> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await getApiWorkspacesByIdCatalogSkillsByScopeByNameFiles({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

export const listAgentFiles = async (fqn: string): Promise<CatalogFileEntry[]> => {
  const { scope, name } = splitFqn(fqn);
  return unwrap(
    await getApiWorkspacesByIdCatalogAgentsByScopeByNameFiles({
      path: { id: requireWorkspaceId(), scope, name },
    }),
  );
};

/**
 * Fetch one catalog file's raw bytes. The same `{scope}/{name}/files`
 * endpoint that lists files streams a single file's bytes when `?path=`
 * is set, so the relative path rides as a query param (it is itself
 * slash-bearing and of arbitrary depth, which a single path segment
 * can't carry). Kept on raw `fetch` because the response is binary,
 * not the JSON the generated op parses.
 */
export const getSkillFile = (fqn: string, relPath: string): Promise<ArrayBuffer> => {
  const { scope, name } = splitFqn(fqn);
  const url = `${catalogPrefix()}/skills/${encodeURIComponent(scope)}/${encodeURIComponent(
    name,
  )}/files?path=${encodeURIComponent(relPath)}`;
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`skill file: ${r.status}`);
    return r.arrayBuffer();
  });
};

export const getAgentFile = (fqn: string, relPath: string): Promise<ArrayBuffer> => {
  const { scope, name } = splitFqn(fqn);
  const url = `${catalogPrefix()}/agents/${encodeURIComponent(scope)}/${encodeURIComponent(
    name,
  )}/files?path=${encodeURIComponent(relPath)}`;
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`agent file: ${r.status}`);
    return r.arrayBuffer();
  });
};
