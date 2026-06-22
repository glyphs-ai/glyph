import type {
  Agent,
  AgentEntry,
  BlockedReason,
  Mcp,
  MissingDep,
  Skill,
  SkillEntry,
} from "@glyphs-ai/contracts";
import { fetchJson, jsonInit, mutate, mutateJson, workspacePrefix } from "./http.js";

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

export async function fetchAll(): Promise<CatalogData> {
  const base = catalogPrefix();
  const [overview, skills, agents, mcps] = await Promise.all([
    fetchJson<OverviewData>(`${base}/overview`, "overview"),
    fetchJson<SkillEntry[]>(`${base}/skills`, "skills"),
    fetchJson<AgentEntry[]>(`${base}/agents`, "agents"),
    fetchJson<McpItem[]>(`${base}/mcps`, "mcps"),
  ]);
  return { overview, skills, agents, mcps };
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
 * Wire body for every catalog install / install-resolve route. The
 * `origin` field is the canonical URI the server's fetcher dispatches
 * on; it is identical to what `dependencies:` blocks reference inside
 * SKILL.md / AGENTS.md. CLI users type one of these directly; the
 * dashboard assembles it from its UI form via
 * {@link buildOriginFromSource}.
 */
interface InstallBody {
  readonly origin: string;
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
 * caller through {@link InstallResult}; the shared `extractError`
 * helper formats the error string the user sees.
 *
 * Scope is determined entirely by each entry's frontmatter (or the
 * default `public`). There is intentionally no per-install
 * `scopeHints` field: forking into a different scope means editing
 * the upstream's frontmatter, not flipping a UI toggle.
 */
export const installAgent = (src: InstallSource): Promise<InstallResult> =>
  mutateJson<InstallResult>(
    `${catalogPrefix()}/agents`,
    jsonInit("POST", { origin: buildOriginFromSource(src) } satisfies InstallBody),
  );

/** See {@link installAgent}. */
export const installSkill = (src: InstallSource): Promise<InstallResult> =>
  mutateJson<InstallResult>(
    `${catalogPrefix()}/skills`,
    jsonInit("POST", { origin: buildOriginFromSource(src) } satisfies InstallBody),
  );

/**
 * Install an MCP. The MCP's spec FQN is recovered from the fetched
 * JSON's `_meta.name` at install time, so callers don't need to
 * supply a name.
 */
export const installMcp = (src: InstallSource): Promise<InstallResult> =>
  mutateJson<InstallResult>(
    `${catalogPrefix()}/mcps`,
    jsonInit("POST", { origin: buildOriginFromSource(src) } satisfies InstallBody),
  );

/**
 * Resolve manifest returned by `POST /catalog/{kind}/resolve` (install)
 * and `POST /catalog/{kind}/:fqn/sync/resolve` (sync). Read-only
 * preview of the dep graph the operation will create. Used by the
 * dashboard's two-phase install/sync dialog.
 *
 * Sync-only fields (`isSync`, `upToDate`, `identityChange`, `orphans`)
 * are populated by the sync resolve endpoint; install resolve leaves
 * them at their no-op defaults.
 */
interface ResolveNodeBase {
  kind: "skill" | "agent" | "mcp";
  origin: string;
  fqn: string;
  status:
    | "new"
    | "will-sync"
    | "already-installed"
    | "up-to-date"
    | "identity-changed"
    | "would-conflict"
    | "fetch-failed"
    | "parse-failed";
  depFqns: string[];
  identityChange?: { oldFqn: string; newFqn: string };
  error?: { name: string; message: string };
}

interface SkillResolveNode extends ResolveNodeBase {
  kind: "skill";
  shortName: string;
  /** Scope as it'll appear in the catalog (frontmatter or `public` default). */
  scope: string;
}

interface AgentResolveNode extends ResolveNodeBase {
  kind: "agent";
  shortName: string;
  scope: string;
}

interface McpResolveNode extends ResolveNodeBase {
  kind: "mcp";
  specName: string;
}

export type ResolveNode = SkillResolveNode | AgentResolveNode | McpResolveNode;

export interface OrphanManifestEntry {
  kind: "skill" | "mcp";
  fqn: string;
  origin: string;
}

export interface ResolveManifest {
  rootOrigin: string;
  rootFqn: string;
  isSync: boolean;
  /**
   * Single-use token returned only by sync resolves. The dashboard
   * stores it across the preview-then-apply UX and ships it back on
   * `apply*Sync(fqn, planToken)`; the server replays the exact
   * preview-time plan rather than re-resolving (which would silently
   * apply a fresh, possibly-different closure).
   *
   * Server TTL is currently 5 min. If the user lets the preview sit
   * too long, apply returns 410 and the dashboard should re-preview.
   *
   * Absent on install resolves — install is naturally idempotent
   * since the user re-supplies the same origin.
   */
  planToken?: string;
  upToDate: boolean;
  identityChange?: { kind: "skill" | "agent" | "mcp"; oldFqn: string; newFqn: string };
  orphans: OrphanManifestEntry[];
  nodes: ResolveNode[];
}

/**
 * Resolve an install (`POST /catalog/{kind}/resolve`) — returns the
 * read-only `ResolveManifest` so the user can preview the tree before
 * committing.
 */
export const resolveSkillInstall = (src: InstallSource): Promise<ResolveManifest> =>
  mutateJson<ResolveManifest>(
    `${catalogPrefix()}/skills/resolve`,
    jsonInit("POST", { origin: buildOriginFromSource(src) } satisfies InstallBody),
  );

export const resolveAgentInstall = (src: InstallSource): Promise<ResolveManifest> =>
  mutateJson<ResolveManifest>(
    `${catalogPrefix()}/agents/resolve`,
    jsonInit("POST", { origin: buildOriginFromSource(src) } satisfies InstallBody),
  );

/**
 * Resolve a sync from upstream for an already-installed entry. The
 * server reads the entry's local origin from the row; the dashboard
 * passes only the local fqn / mcp name in the URL.
 *
 * Sync resolve emits a richer manifest than install resolve:
 *  - `upToDate` short-circuits the apply button when nothing changed
 *  - `identityChange` warns when upstream renamed under the same URL
 *  - `orphans` lists deps that the new closure dropped
 */
export const resolveSkillSync = (fqn: string): Promise<ResolveManifest> =>
  mutateJson<ResolveManifest>(`${catalogPrefix()}/skills/${encodeURIComponent(fqn)}/sync/resolve`, {
    method: "POST",
  });

export const resolveAgentSync = (fqn: string): Promise<ResolveManifest> =>
  mutateJson<ResolveManifest>(`${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/sync/resolve`, {
    method: "POST",
  });

export const resolveMcpSync = (name: string): Promise<ResolveManifest> =>
  mutateJson<ResolveManifest>(`${catalogPrefix()}/mcps/${encodeURIComponent(name)}/sync/resolve`, {
    method: "POST",
  });

/**
 * Apply a previously-previewed sync. The `planToken` MUST come from
 * the matching `resolve*Sync` response — the server replays that
 * exact plan instead of re-resolving (otherwise upstream drift
 * between preview and apply would silently change what gets
 * installed). Token is single-use; a 410 means it expired (default
 * 5 min) or was already consumed, and the dashboard should
 * re-preview.
 */
export const applySkillSync = (fqn: string, planToken: string): Promise<SyncResult> =>
  mutateJson<SyncResult>(
    `${catalogPrefix()}/skills/${encodeURIComponent(fqn)}/sync`,
    jsonInit("POST", { planToken }),
  );

export const applyAgentSync = (fqn: string, planToken: string): Promise<SyncResult> =>
  mutateJson<SyncResult>(
    `${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/sync`,
    jsonInit("POST", { planToken }),
  );

export const applyMcpSync = (name: string, planToken: string): Promise<SyncResult> =>
  mutateJson<SyncResult>(
    `${catalogPrefix()}/mcps/${encodeURIComponent(name)}/sync`,
    jsonInit("POST", { planToken }),
  );

/** Acknowledge prereqs: flips `prereqsAck=true` so the entry can run again. */
export const acknowledgeSkillPrereqs = (fqn: string) =>
  mutate(`${catalogPrefix()}/skills/${encodeURIComponent(fqn)}/acknowledge-prereqs`, {
    method: "POST",
  });

export const acknowledgeAgentPrereqs = (fqn: string) =>
  mutate(`${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/acknowledge-prereqs`, {
    method: "POST",
  });

/** Disable / enable an agent (user-controlled toggle; agents only). */
export const disableAgent = (fqn: string) =>
  mutate(`${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/disable`, { method: "POST" });

export const enableAgent = (fqn: string) =>
  mutate(`${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/enable`, { method: "POST" });

export const deleteAgent = (name: string) =>
  mutate(`${catalogPrefix()}/agents/${encodeURIComponent(name)}`, { method: "DELETE" });

export const deleteSkill = (name: string) =>
  mutate(`${catalogPrefix()}/skills/${encodeURIComponent(name)}`, { method: "DELETE" });

export const deleteMcp = (name: string) =>
  mutate(`${catalogPrefix()}/mcps/${encodeURIComponent(name)}`, { method: "DELETE" });

export interface McpDetail {
  name: string;
  origin: string;
  orphaned: boolean;
  /** Raw JSON content as stored on disk (preserves user formatting). */
  content: string;
}

export const getMcp = (name: string): Promise<McpDetail> =>
  fetchJson<McpDetail>(`${catalogPrefix()}/mcps/${encodeURIComponent(name)}`, "mcp");

export interface SkillDetail {
  skill: Skill;
  status: "ready" | "blocked";
  blockedReason?: BlockedReason;
  missingDeps?: MissingDep[];
  content: string;
}

export const getSkill = (name: string): Promise<SkillDetail> =>
  fetchJson<SkillDetail>(`${catalogPrefix()}/skills/${encodeURIComponent(name)}`, "skill");

export interface AgentDetail {
  agent: Agent;
  status: "ready" | "blocked";
  blockedReason?: BlockedReason;
  missingDeps?: MissingDep[];
  content: string;
}

export const getAgent = (name: string): Promise<AgentDetail> =>
  fetchJson<AgentDetail>(`${catalogPrefix()}/agents/${encodeURIComponent(name)}`, "agent");

// ── File browser API ────────────────────────────────────────────────

/** Wire shape for a single file in the catalog file listing. */
export interface CatalogFileEntry {
  relPath: string;
  size: number;
}

export const listSkillFiles = (fqn: string): Promise<CatalogFileEntry[]> =>
  fetchJson<CatalogFileEntry[]>(
    `${catalogPrefix()}/skills/${encodeURIComponent(fqn)}/files`,
    "skill-files",
  );

export const listAgentFiles = (fqn: string): Promise<CatalogFileEntry[]> =>
  fetchJson<CatalogFileEntry[]>(
    `${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/files`,
    "agent-files",
  );

export const getSkillFile = (fqn: string, relPath: string): Promise<ArrayBuffer> => {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  const url = `${catalogPrefix()}/skills/${encodeURIComponent(fqn)}/files/${encoded}`;
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`skill file: ${r.status}`);
    return r.arrayBuffer();
  });
};

export const getAgentFile = (fqn: string, relPath: string): Promise<ArrayBuffer> => {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  const url = `${catalogPrefix()}/agents/${encodeURIComponent(fqn)}/files/${encoded}`;
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`agent file: ${r.status}`);
    return r.arrayBuffer();
  });
};
